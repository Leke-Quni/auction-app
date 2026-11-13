import {
  BID_REFUSAL_MESSAGES,
  endsAtAfterBid,
  extensionCeiling,
  isFinalChance,
  MAX_STRIKES,
  minimumNextBidCents,
  resolveProxyBid,
  type BidRefusal,
  type PlaceBidInput,
  type ProxyOutcome,
} from "@auction/shared";
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { bidLimits } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";
import { AuctionEvents } from "./auction-events";

const REFUSAL_STATUS: Record<BidRefusal, HttpStatus> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  NOT_LIVE: HttpStatus.CONFLICT,
  OWN_LISTING: HttpStatus.FORBIDDEN,
  MAX_NOT_HIGHER: HttpStatus.CONFLICT,
  TOO_LOW: HttpStatus.UNPROCESSABLE_ENTITY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  BLOCKED: HttpStatus.FORBIDDEN,
};

// The code lets the page say why in words; the minimum lets it fill the box in again.
export const refusal = (reason: BidRefusal, extra: Record<string, unknown> = {}) =>
  new HttpException({ code: reason, message: BID_REFUSAL_MESSAGES[reason], ...extra }, REFUSAL_STATUS[reason]);

const KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";

// Database failures that are not the bidder's fault, as answers they can act on instead of a bare 500. A failed bid
// is rolled back whole, so trying again with the same key is always safe.
export function bidFailure(error: unknown): HttpException | undefined {
  const code = (error as { code?: string } | null)?.code;
  if (code === "P2002") return new ConflictException({ code: KEY_REUSED, message: "That bid key was already used for a different bid." });
  if (code === "P2003") return refusal("NOT_FOUND"); // the listing or the bidder was deleted while the bid ran
  // The pg pool gives up with a plain Error (no Prisma code) when no connection is free within DB_CONNECT_TIMEOUT_MS.
  const poolTimeout = error instanceof Error && error.message === "timeout exceeded when trying to connect";
  if (code === "P2024" || code === "P2028" || poolTimeout) {
    return new ServiceUnavailableException({ code: "BUSY", message: "Bidding is busy right now. Your bid was not placed; try again." });
  }
  return undefined;
}

interface LockedListing {
  id: string;
  sellerId: string;
  status: "DRAFT" | "PUBLISHED";
  startsAt: Date | null;
  endsAt: Date | null;
  durationDays: number;
  startingPriceCents: number;
  reservePriceCents: number | null;
  currentBidCents: number | null;
  bidCount: number;
  highBidderId: string | null;
  extensionCount: number;
}

// A bid row as it is shown: what it set the price to and who placed it.
export interface BidRowView {
  id: string;
  amountCents: number;
  createdAt: Date;
  bidder: { id: string; username: string };
}

export interface BidResult {
  // The request's own row: what the bidder asked for, at the price it set (for a hidden raise, the unchanged price). With proxy
  // bidding a request can also place automatic rows for the leader, which are in `rows`.
  bid: BidRowView;
  // The visible rows this request created (the request's own and the leader's automatic ones), in the order they were saved.
  rows: BidRowView[];
  // What this request meant for the person who made it, and what their maximum is now (only they are ever told it).
  outcome: ProxyOutcome;
  yourMaxCents: number;
  // The person who made the request, who is not always the leader.
  requestedBy: string;
  listing: {
    id: string;
    currentBidCents: number;
    bidCount: number;
    endsAt: Date;
    extensionCount: number;
    // True when the end time has reached its ceiling, so the auction cannot be extended again.
    finalChance: boolean;
    minimumNextBidCents: number;
    highBidderId: string;
    highBidder: { id: string; username: string };
  };
  // True when this bid moved the end time. Always false for a replay.
  extended: boolean;
  // True when the same bid key had already placed this bid, so nothing new happened.
  replayed: boolean;
  // Who lost the lead to this request, for the outbid notice. Null when the leader did not change (the first bid, a defended
  // bid, a raise) and for a replay.
  previousHighBidderId: string | null;
}

@Injectable()
export class BidsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly events: AuctionEvents,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  private readonly log = new Logger(BidsService.name);

  // The whole decision is one transaction that holds a lock on the listing's row, so two bids at the same moment are
  // handled one after the other: the second sees the first's price and is refused if it no longer clears the minimum.
  // Nothing is accepted without being saved, and a retry with the same key can never place the bid twice.
  async placeBid(bidderId: string, listingId: string, input: PlaceBidInput, ip: string | null): Promise<BidResult> {
    const attempt = { userId: bidderId, listingId, amountCents: input.amountCents, ip };
    let result: BidResult;
    try {
      // A retry of a bid that already went through is answered without counting against the limits, so a bidder on a poor
      // connection can always find out and a genuine new bid is not refused because of the retries.
      const earlier = await this.prisma.bid.findUnique({ where: { bidderId_idempotencyKey: { bidderId, idempotencyKey: input.idempotencyKey } }, select: { id: true } });
      if (!earlier) await this.checkRate(bidderId, ip);
      // Read before the lock is taken, so the check does not lengthen the time the listing's row is held (a strike landing
      // in these few milliseconds changes nothing that matters).
      const strikes = earlier ? 0 : await this.prisma.strike.count({ where: { userId: bidderId } });
      result = await this.prisma.$transaction(
        async (tx) => {
          const [listing] = await tx.$queryRaw<LockedListing[]>`
            SELECT "id", "sellerId", "status", "startsAt", "endsAt", "durationDays", "startingPriceCents", "reservePriceCents", "currentBidCents",
                   "bidCount", "highBidderId", "extensionCount"
            FROM "Listing" WHERE "id" = ${listingId} FOR UPDATE`;

          // A retry of a bid that went through gets the same answer, whatever has happened since.
          const earlier = await tx.bid.findUnique({
            where: { bidderId_idempotencyKey: { bidderId, idempotencyKey: input.idempotencyKey } },
            include: { bidder: { select: { id: true, username: true } } },
          });
          if (earlier) {
            // The same request means the same listing and the same maximum (what was typed, which can differ from the price the row set).
            if (earlier.listingId !== listingId || (earlier.maxCents ?? earlier.amountCents) !== input.amountCents) {
              throw new ConflictException({ code: KEY_REUSED, message: "That bid key was already used for a different bid." });
            }
            const current = listing ?? (await tx.listing.findUniqueOrThrow({ where: { id: listingId } }));
            const leader = current.highBidderId ? await tx.user.findUnique({ where: { id: current.highBidderId }, select: { id: true, username: true } }) : null;
            await tx.bidAudit.create({ data: { ...attempt, outcome: "ACCEPTED", reason: "REPLAY" } });
            return replayOf(earlier, current as LockedListing, leader);
          }

          if (!listing || listing.status !== "PUBLISHED" || !listing.startsAt || !listing.endsAt) throw refusal("NOT_FOUND");
          // The database's clock, read after the lock is won, so every API machine judges the end time by the same time.
          const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
          if (listing.sellerId === bidderId) throw refusal("OWN_LISTING");
          if (now < listing.startsAt || now >= listing.endsAt) throw refusal("NOT_LIVE");
          // Winning and not paying earns a strike; two strikes stop a person bidding at all.
          if (strikes >= MAX_STRIKES) throw refusal("BLOCKED");
          // The leader and what they have typed. A leader with no stored maximum (a bid from before proxy bidding) holds only their price.
          const price = listing.currentBidCents;
          let leader: { bidderId: string; maxCents: number } | null = null;
          if (listing.highBidderId && price !== null) {
            const held = await tx.autoBid.findUnique({ where: { listingId_bidderId: { listingId, bidderId: listing.highBidderId } }, select: { maxCents: true } });
            let maxCents = Math.max(held?.maxCents ?? price, price);
            // A leader who may no longer bid (banned, asked to delete their account, or two strikes) must not keep bidding by
            // themselves: they count as a plain bid at the price they reached. Only asked when there is a maximum to defend with.
            if (maxCents > price) {
              const [{ blocked }] = await tx.$queryRaw<{ blocked: boolean }[]>`
                SELECT (u."bannedAt" IS NOT NULL OR u."deletionRequestedAt" IS NOT NULL OR (SELECT COUNT(*) FROM "Strike" s WHERE s."userId" = u."id") >= ${MAX_STRIKES}) AS "blocked"
                FROM "User" u WHERE u."id" = ${listing.highBidderId}`;
              if (blocked) maxCents = price;
            }
            leader = { bidderId: listing.highBidderId, maxCents };
          }
          const resolved = resolveProxyBid({
            startingPriceCents: listing.startingPriceCents,
            reservePriceCents: listing.reservePriceCents,
            currentBidCents: price,
            leader,
            bidderId,
            maxCents: input.amountCents,
          });
          if (!resolved.ok) throw resolved.reason === "TOO_LOW" ? refusal("TOO_LOW", { minimumNextBidCents: resolved.minimumNextBidCents }) : refusal(resolved.reason);

          // Any change of price in the last two minutes extends the auction, once however many rows it made; a hidden raise never does.
          const ceiling = extensionCeiling(listing.startsAt, listing.durationDays);
          const timing = resolved.priceChanged ? endsAtAfterBid(listing.endsAt, now, ceiling) : { endsAt: listing.endsAt, extended: false };
          const extensionCount = listing.extensionCount + (timing.extended ? 1 : 0);

          // The request's own row keeps the bidder's key; the leader's automatic rows are named after the request (a user's key can
          // never contain a colon). All rows carry the time read from the database after the lock.
          const visible: BidRowView[] = [];
          let own: BidRowView | undefined;
          let automatic = 0;
          for (const row of resolved.rows) {
            const isRequest = row.kind !== "AUTO" && row.bidderId === bidderId;
            const saved = await tx.bid.create({
              data: {
                listingId,
                bidderId: row.bidderId,
                amountCents: row.amountCents,
                kind: row.kind,
                maxCents: isRequest ? input.amountCents : null,
                outcome: isRequest ? resolved.outcome : null,
                idempotencyKey: isRequest ? input.idempotencyKey : `auto:${bidderId}:${input.idempotencyKey}:${automatic++}`,
                ip: isRequest ? ip : null,
                createdAt: now,
              },
              include: { bidder: { select: { id: true, username: true } } },
            });
            const view = { id: saved.id, amountCents: saved.amountCents, createdAt: saved.createdAt, bidder: saved.bidder };
            if (isRequest) own = view;
            if (row.kind !== "RAISE") visible.push(view);
          }
          if (!own) throw new Error("A bid request produced no row of its own");
          // The bidder's maximum only ever rises.
          const [{ maxCents: yourMaxCents }] = await tx.$queryRaw<{ maxCents: number }[]>`
            INSERT INTO "AutoBid" ("listingId", "bidderId", "maxCents", "updatedAt") VALUES (${listingId}, ${bidderId}, ${input.amountCents}, ${now})
            ON CONFLICT ("listingId", "bidderId") DO UPDATE SET "maxCents" = GREATEST("AutoBid"."maxCents", EXCLUDED."maxCents"), "updatedAt" = EXCLUDED."updatedAt"
            RETURNING "maxCents"`;
          await tx.bidAudit.create({
            data: { ...attempt, outcome: "ACCEPTED", ...(resolved.outcome === "MAX_RAISED" ? { reason: "MAX_RAISED" } : resolved.outcome === "OUTBID_BY_PROXY" ? { reason: "PROXY_DEFENDED" } : {}) },
          });
          const bidCount = resolved.priceChanged
            ? (
                await tx.listing.update({
                  where: { id: listingId },
                  data: { currentBidCents: resolved.priceCents, bidCount: { increment: visible.length }, highBidderId: resolved.leaderId, endsAt: timing.endsAt, extensionCount },
                })
              ).bidCount
            : listing.bidCount;
          const leaderView = [own, ...visible].find((v) => v.bidder.id === resolved.leaderId)!.bidder;
          return {
            bid: own,
            rows: visible,
            outcome: resolved.outcome,
            yourMaxCents,
            requestedBy: bidderId,
            listing: {
              id: listing.id,
              currentBidCents: resolved.priceCents,
              bidCount,
              endsAt: timing.endsAt,
              extensionCount,
              finalChance: isFinalChance(timing.endsAt, ceiling),
              minimumNextBidCents: minimumNextBidCents({ startingPriceCents: listing.startingPriceCents, currentBidCents: resolved.priceCents }),
              highBidderId: resolved.leaderId,
              highBidder: leaderView,
            },
            extended: timing.extended,
            replayed: false,
            previousHighBidderId: resolved.leaderChanged ? listing.highBidderId : null,
          };
        },
        // Bids queue up on a hot auction, so give them time to wait for the lock.
        { maxWait: 15_000, timeout: 15_000 },
      );
    } catch (error) {
      // (Two requests with one key for different listings can race past the key check; the database stops the second.)
      const failure = bidFailure(error) ?? error;
      await this.auditRefusal(attempt, failure);
      throw failure;
    }
    // Only now, with the bid committed, does anyone hear of it.
    if (!result.replayed) {
      this.events.publish({ type: "BidPlaced", listingId, result });
      if (result.extended) {
        this.events.publish({ type: "AuctionExtended", listingId, endsAt: result.listing.endsAt, extensionCount: result.listing.extensionCount });
      }
    }
    return result;
  }

  // Every attempt counts, refused or not, so hammering the endpoint with bad bids is limited too.
  private async checkRate(bidderId: string, ip: string | null) {
    const { perUser, perIp } = bidLimits();
    const allowedUser = await this.limiter.allow(`rl:bid-user:${bidderId}`, perUser, 60);
    const allowedIp = ip ? await this.limiter.allow(`rl:bid-ip:${ip}`, perIp, 60) : true;
    if (!allowedUser || !allowedIp) throw refusal("RATE_LIMITED");
  }

  // The accepted rows are written inside the bid's own transaction; a refusal rolled everything back, so it is
  // recorded afterwards. A failure to record never changes the answer the bidder gets.
  private async auditRefusal(attempt: { userId: string; listingId: string; amountCents: number; ip: string | null }, failure: unknown) {
    const body = failure instanceof HttpException ? (failure.getResponse() as { code?: string }) : undefined;
    try {
      // A flood that is already being limited would otherwise write a row for every request: record one a minute.
      if (body?.code === "RATE_LIMITED" && !(await this.limiter.allow(`rl:audit-limited:${attempt.userId}`, 1, 60))) return;
      await this.prisma.bidAudit.create({ data: { ...attempt, outcome: "REFUSED", reason: body?.code ?? "ERROR" } });
    } catch (error) {
      this.log.error(`Could not record a refused bid: ${(error as Error).message}`);
    }
  }

  // Public bid history, newest first. Drafts have none to show.
  async history(listingId: string, limit: number) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { status: true, bidCount: true } });
    if (!listing || listing.status !== "PUBLISHED") throw new NotFoundException();
    const items = await this.prisma.bid.findMany({
      where: { listingId, kind: { not: "RAISE" } },
      orderBy: [{ amountCents: "desc" }, { seq: "desc" }],
      take: limit,
      select: { id: true, amountCents: true, createdAt: true, bidder: { select: { id: true, username: true } } },
    });
    return { items, total: listing.bidCount };
  }
}

function replayOf(
  earlier: { id: string; amountCents: number; createdAt: Date; maxCents: number | null; outcome: ProxyOutcome | null; bidder: { id: string; username: string } },
  listing: Pick<LockedListing, "id" | "currentBidCents" | "bidCount" | "startsAt" | "endsAt" | "durationDays" | "extensionCount" | "highBidderId" | "startingPriceCents">,
  leader: { id: string; username: string } | null,
): BidResult {
  const row = { id: earlier.id, amountCents: earlier.amountCents, createdAt: earlier.createdAt, bidder: earlier.bidder };
  return {
    bid: row,
    rows: [],
    // Said as it was the first time; the maximum is what was typed (a raise may since have been beaten by a later one).
    outcome: earlier.outcome ?? "LEADING",
    yourMaxCents: earlier.maxCents ?? earlier.amountCents,
    requestedBy: earlier.bidder.id,
    listing: {
      id: listing.id,
      currentBidCents: listing.currentBidCents ?? earlier.amountCents,
      bidCount: listing.bidCount,
      endsAt: listing.endsAt as Date,
      extensionCount: listing.extensionCount,
      finalChance: isFinalChance(listing.endsAt as Date, extensionCeiling(listing.startsAt as Date, listing.durationDays)),
      minimumNextBidCents: minimumNextBidCents(listing),
      highBidderId: listing.highBidderId ?? "",
      highBidder: leader ?? earlier.bidder,
    },
    extended: false,
    replayed: true,
    previousHighBidderId: null,
  };
}

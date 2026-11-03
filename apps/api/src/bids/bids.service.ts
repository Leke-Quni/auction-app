import {
  BID_REFUSAL_MESSAGES,
  endsAtAfterBid,
  extensionCeiling,
  isFinalChance,
  minimumNextBidCents,
  type BidRefusal,
  type PlaceBidInput,
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
  ALREADY_HIGHEST: HttpStatus.CONFLICT,
  TOO_LOW: HttpStatus.UNPROCESSABLE_ENTITY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
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
  if (code === "P2024" || code === "P2028") {
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
  currentBidCents: number | null;
  bidCount: number;
  highBidderId: string | null;
  extensionCount: number;
}

export interface BidResult {
  bid: { id: string; amountCents: number; createdAt: Date; bidder: { id: string; username: string } };
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
  };
  // True when this bid moved the end time. Always false for a replay.
  extended: boolean;
  // True when the same bid key had already placed this bid, so nothing new happened.
  replayed: boolean;
  // Who this bid outbid, for the outbid notice. Null for the first bid and for a replay.
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
      try {
        await this.checkRate(bidderId, ip);
      } catch (error) {
        // A retry of a bid that already went through is answered even over the limit, so the bidder can always find out.
        const limited = error instanceof HttpException && (error.getResponse() as { code?: string }).code === "RATE_LIMITED";
        const earlier = limited && (await this.prisma.bid.findUnique({ where: { bidderId_idempotencyKey: { bidderId, idempotencyKey: input.idempotencyKey } }, select: { id: true } }));
        if (!earlier) throw error;
      }
      result = await this.prisma.$transaction(
        async (tx) => {
          const [listing] = await tx.$queryRaw<LockedListing[]>`
            SELECT "id", "sellerId", "status", "startsAt", "endsAt", "durationDays", "startingPriceCents", "currentBidCents", "bidCount",
                   "highBidderId", "extensionCount"
            FROM "Listing" WHERE "id" = ${listingId} FOR UPDATE`;

          // A retry of a bid that went through gets the same answer, whatever has happened since.
          const earlier = await tx.bid.findUnique({
            where: { bidderId_idempotencyKey: { bidderId, idempotencyKey: input.idempotencyKey } },
            include: { bidder: { select: { id: true, username: true } } },
          });
          if (earlier) {
            if (earlier.listingId !== listingId || earlier.amountCents !== input.amountCents) {
              throw new ConflictException({ code: KEY_REUSED, message: "That bid key was already used for a different bid." });
            }
            const current = listing ?? (await tx.listing.findUniqueOrThrow({ where: { id: listingId } }));
            await tx.bidAudit.create({ data: { ...attempt, outcome: "ACCEPTED", reason: "REPLAY" } });
            return replayOf(earlier, current as LockedListing);
          }

          if (!listing || listing.status !== "PUBLISHED" || !listing.startsAt || !listing.endsAt) throw refusal("NOT_FOUND");
          // The database's clock, read after the lock is won, so every API machine judges the end time by the same time.
          const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
          if (listing.sellerId === bidderId) throw refusal("OWN_LISTING");
          if (now < listing.startsAt || now >= listing.endsAt) throw refusal("NOT_LIVE");
          if (listing.highBidderId === bidderId) throw refusal("ALREADY_HIGHEST");
          const minimum = minimumNextBidCents(listing);
          if (input.amountCents < minimum) throw refusal("TOO_LOW", { minimumNextBidCents: minimum });

          const ceiling = extensionCeiling(listing.startsAt, listing.durationDays);
          const timing = endsAtAfterBid(listing.endsAt, now, ceiling);
          const extensionCount = listing.extensionCount + (timing.extended ? 1 : 0);
          const bid = await tx.bid.create({
            data: { listingId, bidderId, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey, ip },
            include: { bidder: { select: { id: true, username: true } } },
          });
          await tx.bidAudit.create({ data: { ...attempt, outcome: "ACCEPTED" } });
          const updated = await tx.listing.update({
            where: { id: listingId },
            data: {
              currentBidCents: input.amountCents,
              bidCount: { increment: 1 },
              highBidderId: bidderId,
              endsAt: timing.endsAt,
              extensionCount,
            },
          });
          return {
            bid: { id: bid.id, amountCents: bid.amountCents, createdAt: bid.createdAt, bidder: bid.bidder },
            listing: {
              id: updated.id,
              currentBidCents: input.amountCents,
              bidCount: updated.bidCount,
              endsAt: timing.endsAt,
              extensionCount,
              finalChance: isFinalChance(timing.endsAt, ceiling),
              minimumNextBidCents: minimumNextBidCents({ startingPriceCents: updated.startingPriceCents, currentBidCents: input.amountCents }),
              highBidderId: bidderId,
            },
            extended: timing.extended,
            replayed: false,
            previousHighBidderId: listing.highBidderId,
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
      where: { listingId },
      orderBy: [{ amountCents: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, amountCents: true, createdAt: true, bidder: { select: { id: true, username: true } } },
    });
    return { items, total: listing.bidCount };
  }
}

function replayOf(
  earlier: { id: string; amountCents: number; createdAt: Date; bidder: { id: string; username: string } },
  listing: Pick<LockedListing, "id" | "currentBidCents" | "bidCount" | "startsAt" | "endsAt" | "durationDays" | "extensionCount" | "highBidderId" | "startingPriceCents">,
): BidResult {
  return {
    bid: { id: earlier.id, amountCents: earlier.amountCents, createdAt: earlier.createdAt, bidder: earlier.bidder },
    listing: {
      id: listing.id,
      currentBidCents: listing.currentBidCents ?? earlier.amountCents,
      bidCount: listing.bidCount,
      endsAt: listing.endsAt as Date,
      extensionCount: listing.extensionCount,
      finalChance: isFinalChance(listing.endsAt as Date, extensionCeiling(listing.startsAt as Date, listing.durationDays)),
      minimumNextBidCents: minimumNextBidCents(listing),
      highBidderId: listing.highBidderId ?? "",
    },
    extended: false,
    replayed: true,
    previousHighBidderId: null,
  };
}

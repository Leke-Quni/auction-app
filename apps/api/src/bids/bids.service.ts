import {
  BID_REFUSAL_MESSAGES,
  endsAtAfterBid,
  minimumNextBidCents,
  type BidRefusal,
  type PlaceBidInput,
} from "@auction/shared";
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { isUniqueViolation } from "../common/errors";

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

interface LockedListing {
  id: string;
  sellerId: string;
  status: "DRAFT" | "PUBLISHED";
  startsAt: Date | null;
  endsAt: Date | null;
  startingPriceCents: number;
  currentBidCents: number | null;
  bidCount: number;
  highBidderId: string | null;
  extensionCount: number;
}

export interface BidResult {
  bid: { id: string; amountCents: number; createdAt: Date };
  listing: {
    id: string;
    currentBidCents: number;
    bidCount: number;
    endsAt: Date;
    extensionCount: number;
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
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  // The whole decision is one transaction that holds a lock on the listing's row, so two bids at the same moment are
  // handled one after the other: the second sees the first's price and is refused if it no longer clears the minimum.
  // Nothing is accepted without being saved, and a retry with the same key can never place the bid twice.
  async placeBid(bidderId: string, listingId: string, input: PlaceBidInput, ip: string | null): Promise<BidResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [listing] = await tx.$queryRaw<LockedListing[]>`
            SELECT "id", "sellerId", "status", "startsAt", "endsAt", "startingPriceCents", "currentBidCents", "bidCount",
                   "highBidderId", "extensionCount"
            FROM "Listing" WHERE "id" = ${listingId} FOR UPDATE`;

          // A retry of a bid that went through gets the same answer, whatever has happened since.
          const earlier = await tx.bid.findUnique({
            where: { bidderId_idempotencyKey: { bidderId, idempotencyKey: input.idempotencyKey } },
          });
          if (earlier) {
            if (earlier.listingId !== listingId || earlier.amountCents !== input.amountCents) {
              throw new ConflictException({ code: KEY_REUSED, message: "That bid key was already used for a different bid." });
            }
            const current = listing ?? (await tx.listing.findUniqueOrThrow({ where: { id: listingId } }));
            return replayOf(earlier, current as LockedListing);
          }

          if (!listing || listing.status !== "PUBLISHED" || !listing.startsAt || !listing.endsAt) throw refusal("NOT_FOUND");
          const now = new Date();
          if (listing.sellerId === bidderId) throw refusal("OWN_LISTING");
          if (now < listing.startsAt || now >= listing.endsAt) throw refusal("NOT_LIVE");
          if (listing.highBidderId === bidderId) throw refusal("ALREADY_HIGHEST");
          const minimum = minimumNextBidCents(listing);
          if (input.amountCents < minimum) throw refusal("TOO_LOW", { minimumNextBidCents: minimum });

          const timing = endsAtAfterBid(listing.endsAt, now, listing.extensionCount);
          const bid = await tx.bid.create({
            data: { listingId, bidderId, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey, ip },
          });
          const updated = await tx.listing.update({
            where: { id: listingId },
            data: {
              currentBidCents: input.amountCents,
              bidCount: { increment: 1 },
              highBidderId: bidderId,
              endsAt: timing.endsAt,
              extensionCount: timing.extensionCount,
            },
          });
          return {
            bid: { id: bid.id, amountCents: bid.amountCents, createdAt: bid.createdAt },
            listing: {
              id: updated.id,
              currentBidCents: input.amountCents,
              bidCount: updated.bidCount,
              endsAt: timing.endsAt,
              extensionCount: timing.extensionCount,
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
      // Two requests with one key for different listings can race past the check above; the database stops the second.
      if (isUniqueViolation(error)) {
        throw new ConflictException({ code: KEY_REUSED, message: "That bid key was already used for a different bid." });
      }
      throw error;
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
  earlier: { id: string; amountCents: number; createdAt: Date },
  listing: Pick<LockedListing, "id" | "currentBidCents" | "bidCount" | "endsAt" | "extensionCount" | "highBidderId" | "startingPriceCents">,
): BidResult {
  return {
    bid: { id: earlier.id, amountCents: earlier.amountCents, createdAt: earlier.createdAt },
    listing: {
      id: listing.id,
      currentBidCents: listing.currentBidCents ?? earlier.amountCents,
      bidCount: listing.bidCount,
      endsAt: listing.endsAt as Date,
      extensionCount: listing.extensionCount,
      minimumNextBidCents: minimumNextBidCents(listing),
      highBidderId: listing.highBidderId ?? "",
    },
    extended: false,
    replayed: true,
    previousHighBidderId: null,
  };
}

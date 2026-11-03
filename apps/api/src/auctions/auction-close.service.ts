import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AuctionEvents } from "../bids/auction-events";
import { PRISMA, type Prisma } from "../db/db.module";

const SWEEP_EVERY_MS = 10_000;
const SWEEP_BATCH = 100;

interface ClosedRow {
  id: string;
  outcome: "SOLD" | "NO_SALE" | "NO_BIDS";
  winnerId: string | null;
  finalPriceCents: number | null;
}

// Closes auctions once their end time has passed: no bids, reserve not met, or sold to the high bidder. Closing is one
// UPDATE that only matches a published, unclosed auction whose end time has passed by the database's clock, so a second
// run (a duplicate call, a second machine, the sweep catching up) changes nothing and publishes nothing. A bid that is
// extending the auction at the same moment holds the row lock; once it commits, the new end time no longer matches and
// the auction stays open.
@Injectable()
export class AuctionCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AuctionCloseService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly events: AuctionEvents,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Returns true when this call closed the auction.
  async close(listingId: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<ClosedRow[]>`
      UPDATE "Listing" SET
        "closedAt" = clock_timestamp(),
        "outcome" = CASE
          WHEN "highBidderId" IS NULL THEN 'NO_BIDS'::"ListingOutcome"
          WHEN "reservePriceCents" IS NOT NULL AND "currentBidCents" < "reservePriceCents" THEN 'NO_SALE'::"ListingOutcome"
          ELSE 'SOLD'::"ListingOutcome"
        END,
        "winnerId" = CASE WHEN "highBidderId" IS NOT NULL AND ("reservePriceCents" IS NULL OR "currentBidCents" >= "reservePriceCents") THEN "highBidderId" END,
        "finalPriceCents" = CASE WHEN "highBidderId" IS NOT NULL AND ("reservePriceCents" IS NULL OR "currentBidCents" >= "reservePriceCents") THEN "currentBidCents" END
      WHERE "id" = ${listingId} AND "status" = 'PUBLISHED' AND "closedAt" IS NULL AND "endsAt" <= clock_timestamp()
      RETURNING "id", "outcome", "winnerId", "finalPriceCents"`;
    if (!row) return false;
    this.events.publish({ type: "AuctionClosed", listingId: row.id, outcome: row.outcome, winnerId: row.winnerId, finalPriceCents: row.finalPriceCents });
    return true;
  }

  // Safety net and, for now, the only trigger: closes whatever has ended and is still open. Safe to run on every machine.
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let closed = 0;
    try {
      const due = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Listing"
        WHERE "status" = 'PUBLISHED' AND "closedAt" IS NULL AND "endsAt" <= clock_timestamp()
        ORDER BY "endsAt" LIMIT ${SWEEP_BATCH}`;
      for (const { id } of due) {
        try {
          if (await this.close(id)) closed++;
        } catch (error) {
          this.log.error(`Could not close listing ${id}: ${(error as Error).message}`);
        }
      }
      if (closed > 0) this.log.log(`Closed ${closed} ended auction${closed === 1 ? "" : "s"}`);
    } catch (error) {
      this.log.error(`Auction close sweep failed: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
    return closed;
  }
}

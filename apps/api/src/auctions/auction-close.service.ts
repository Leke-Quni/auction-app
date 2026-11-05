import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { platformFeeCents } from "@auction/shared";
import { AuctionEvents } from "../bids/auction-events";
import { paymentWindowHours, platformFeeCapCents, platformFeePercent } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { JOB_SCHEDULER, type JobScheduler } from "../jobs/job-scheduler";

const SWEEP_EVERY_MS = 10_000;
const SWEEP_BATCH = 100;
// A listing that fails to close is left out of the sweep for this long, so a few broken ones cannot fill every batch.
const RETRY_FAILED_AFTER_MS = 5 * 60_000;

interface ClosedRow {
  id: string;
  sellerId: string;
  outcome: "SOLD" | "NO_SALE" | "NO_BIDS";
  winnerId: string | null;
  closedAt: Date;
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
  private readonly failedUntil = new Map<string, number>();

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly events: AuctionEvents,
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobScheduler,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Returns true when this call closed the auction. In the same transaction, everyone who bid and did not win is owed an
  // "auction ended" email, any outbid email still waiting for this auction is dropped (that email covers it), and the
  // auction's notifications expire (the latest "You've been outbid" of each loser stays).
  async close(listingId: string): Promise<boolean> {
    return this.run(listingId);
  }

  // An admin takes the auction down: it ends now with no sale, whatever the bids and the reserve, in the same transaction as
  // the close below, so the end, the result and the emails to the bidders all land together. Only a published auction that
  // has not been closed qualifies; a bid that holds the row's lock finishes first. Returns false when nothing matched.
  async closeRemoved(listingId: string, removal: { adminId: string; reason: string }): Promise<boolean> {
    return this.run(listingId, removal);
  }

  private async run(listingId: string, removal?: { adminId: string; reason: string }): Promise<boolean> {
    let order: { id: string; payBy: Date } | undefined;
    const row = await this.prisma.$transaction(async (tx) => {
      if (removal) {
        const ended = await tx.$executeRaw`
          UPDATE "Listing" SET
            "endsAt" = LEAST("endsAt", clock_timestamp()),
            "startsAt" = LEAST("startsAt", clock_timestamp()),
            "removedAt" = clock_timestamp(), "removedById" = ${removal.adminId}, "removalReason" = ${removal.reason}
          WHERE "id" = ${listingId} AND "status" = 'PUBLISHED' AND "closedAt" IS NULL`;
        if (ended === 0) return null;
      }
      const [closed] = await tx.$queryRaw<ClosedRow[]>`
        UPDATE "Listing" SET
          "closedAt" = clock_timestamp(),
          "outcome" = CASE
            WHEN "highBidderId" IS NULL THEN 'NO_BIDS'::"ListingOutcome"
            WHEN "removedAt" IS NOT NULL OR ("reservePriceCents" IS NOT NULL AND "currentBidCents" < "reservePriceCents") THEN 'NO_SALE'::"ListingOutcome"
            ELSE 'SOLD'::"ListingOutcome"
          END,
          "winnerId" = CASE WHEN "highBidderId" IS NOT NULL AND "removedAt" IS NULL AND ("reservePriceCents" IS NULL OR "currentBidCents" >= "reservePriceCents") THEN "highBidderId" END,
          "finalPriceCents" = CASE WHEN "highBidderId" IS NOT NULL AND "removedAt" IS NULL AND ("reservePriceCents" IS NULL OR "currentBidCents" >= "reservePriceCents") THEN "currentBidCents" END
        WHERE "id" = ${listingId} AND "status" = 'PUBLISHED' AND "closedAt" IS NULL AND ("endsAt" <= clock_timestamp() OR "removedAt" IS NOT NULL)
        RETURNING "id", "sellerId", "outcome", "winnerId", "finalPriceCents", "closedAt"`;
      // A removal already ended the auction in this transaction, so a miss here must undo it rather than leave it half done.
      if (!closed && removal) throw new Error(`Could not close the removed listing ${listingId}`);
      if (!closed) return null;
      await tx.$executeRaw`
        INSERT INTO "PendingEndEmail" ("id", "userId", "listingId", "kind")
        SELECT gen_random_uuid()::text, b."bidderId", ${listingId}, 'LOST'::"EndEmailKind" FROM (SELECT DISTINCT "bidderId" FROM "Bid" WHERE "listingId" = ${listingId}) b
        WHERE b."bidderId" IS DISTINCT FROM ${closed.winnerId}
        ON CONFLICT ("userId", "listingId", "kind") DO NOTHING`;
      if (closed.outcome === "SOLD" && closed.winnerId && closed.finalPriceCents != null) {
        const listing = await tx.listing.findUnique({ where: { id: listingId }, select: { pickupAddress: true } });
        const feeCents = platformFeeCents(closed.finalPriceCents, platformFeePercent(), platformFeeCapCents());
        order = await tx.order.create({
          data: {
            listingId,
            buyerId: closed.winnerId,
            sellerId: closed.sellerId,
            amountCents: closed.finalPriceCents,
            feeCents,
            sellerNetCents: closed.finalPriceCents - feeCents,
            ...(listing?.pickupAddress ? { pickupAddress: listing.pickupAddress } : {}),
            payBy: new Date(closed.closedAt.getTime() + paymentWindowHours() * 3600_000),
          },
        });
        await tx.pendingEndEmail.create({ data: { userId: closed.winnerId, listingId, kind: "WON" } });
      }
      await tx.$executeRaw`DELETE FROM "PendingOutbidEmail" WHERE "listingId" = ${listingId}`;
      await tx.$executeRaw`
        UPDATE "Notification" SET "expiresAt" = LEAST("expiresAt", clock_timestamp())
        WHERE "listingId" = ${listingId} AND ("type" <> 'OUTBID' OR "userId" IS NOT DISTINCT FROM ${closed.winnerId})`;
      return closed;
    });
    if (!row) return false;
    if (order) await this.scheduler.scheduleOrderExpiry(order.id, order.payBy);
    this.events.publish({ type: "AuctionClosed", listingId: row.id, outcome: row.outcome, winnerId: row.winnerId, finalPriceCents: row.finalPriceCents });
    return true;
  }

  // Safety net for the QStash call (and the only trigger when QStash is not configured): closes whatever has ended and is still open. Safe to run on every machine.
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let closed = 0;
    try {
      const now = Date.now();
      for (const [id, until] of this.failedUntil) if (until <= now) this.failedUntil.delete(id);
      const skip = [...this.failedUntil.keys()];
      const due = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Listing"
        WHERE "status" = 'PUBLISHED' AND "closedAt" IS NULL AND "endsAt" <= clock_timestamp()
          AND "id" <> ALL(${skip}::text[])
        ORDER BY "endsAt" LIMIT ${SWEEP_BATCH}`;
      for (const { id } of due) {
        try {
          if (await this.close(id)) closed++;
        } catch (error) {
          this.failedUntil.set(id, Date.now() + RETRY_FAILED_AFTER_MS);
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

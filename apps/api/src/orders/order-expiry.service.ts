import { MAX_PAYMENT_ROUNDS, MAX_STRIKES } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AuctionEvents } from "../bids/auction-events";
import { PRISMA, type Prisma } from "../db/db.module";
import { FailureBackoff, runEvery } from "../jobs/sweep-support";
import { JOB_SCHEDULER, type JobScheduler } from "../jobs/job-scheduler";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider";
import { queueMail } from "../email/mail-outbox";
import { notificationKey } from "../notifications/notification-keys";
import { offerItem } from "./offer-item";
import { OrdersService } from "./orders.service";

const SWEEP_EVERY_MS = 30_000;
const SWEEP_BATCH = 100;
// An order that fails to expire is left out of the sweep for this long, so a few broken ones cannot fill every batch.
const RETRY_FAILED_AFTER_MS = 5 * 60_000;
// If the provider still cannot be asked this long after the deadline, the order is expired anyway, so one unreadable
// checkout session cannot hold up the strike and the runner-up offer for ever. A payment that lands later is refunded.
const GIVE_UP_CHECKING_AFTER_MS = 24 * 3600_000;

export interface ExpiryResult {
  orderId: string;
  listingId: string;
  // Who the item was offered to next, and at what price; null when no remaining bid qualified (no sale).
  nextBuyerId: string | null;
  nextAmountCents: number | null;
}

// Gives up on orders that were not paid in time. For each one, in a single transaction: the order is marked EXPIRED, the
// buyer gets a strike, and the item is offered to the next bidder at their own highest bid (a new order with a fresh
// payment window) if that bid meets the reserve, or the auction ends without a sale if no remaining bid does. Emails to the
// non-payer, the seller and the new buyer are queued in the same transaction. The update only matches an order that is still
// waiting and past its deadline, so duplicate runs, several machines and the sweep catching up change nothing twice.
@Injectable()
export class OrderExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OrderExpiryService.name);
  private stop?: () => void;
  private sweeping = false;
  private readonly failed = new FailureBackoff(RETRY_FAILED_AFTER_MS);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    private readonly orders: OrdersService,
    private readonly events: AuctionEvents,
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobScheduler,
  ) {}

  onModuleInit() {
    this.stop = runEvery(SWEEP_EVERY_MS, () => this.sweep());
    void this.sweep();
  }

  onModuleDestroy() {
    this.stop?.();
  }

  // Returns what happened if this call expired the order, or null if it did nothing (not due, not waiting, already
  // expired, or paid after all).
  async expire(orderId: string): Promise<ExpiryResult | null> {
    // A payment that was taken but not yet reported must not cost the buyer a strike. If the provider cannot be asked
    // right now, throw so the sweep backs off and tries again later, rather than punishing on a guess (until the
    // deadline is long past; see GIVE_UP_CHECKING_AFTER_MS).
    let giveUp = false;
    try {
      if (await this.orders.settleIfPaid(orderId)) return null;
    } catch (error) {
      giveUp = await this.longOverdue(orderId);
      if (!giveUp) throw error;
      this.log.error(`Could not check payments for order ${orderId} ${GIVE_UP_CHECKING_AFTER_MS / 3600_000} hours after its deadline; expiring it anyway: ${(error as Error).message}`);
    }

    // Checkout pages still open must be closed before the order is given up on, so the buyer cannot pay for an item that
    // is offered to someone else. If one cannot be closed now, nothing is expired yet and the sweep tries again (unless
    // the deadline is long past, when a payment that still lands is refunded instead).
    const due = await this.prisma.$queryRaw<{ paymentRef: string | null; paymentRefs: string[] }[]>`
      SELECT "paymentRef", "paymentRefs" FROM "Order"
      WHERE "id" = ${orderId} AND "status" = 'AWAITING_PAYMENT' AND "payBy" <= clock_timestamp()`;
    if (due.length === 0) return null;
    for (const ref of new Set([...(due[0]!.paymentRef ? [due[0]!.paymentRef] : []), ...due[0]!.paymentRefs])) {
      try {
        await this.payments.expireCheckout(ref);
      } catch (error) {
        if (!giveUp && !(await this.longOverdue(orderId))) throw error;
        this.log.error(`Could not close session ${ref} of order ${orderId}: ${(error as Error).message}`);
      }
    }

    let offered: { id: string; payBy: Date } | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      // Judged by the database's clock, like the close and the bids, so several machines agree on the deadline.
      const marked = await tx.$executeRaw`
        UPDATE "Order" SET "status" = 'EXPIRED', "updatedAt" = clock_timestamp()
        WHERE "id" = ${orderId} AND "status" = 'AWAITING_PAYMENT' AND "payBy" <= clock_timestamp()`;
      if (marked === 0) return null;
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { listingId: true, buyerId: true, sellerId: true, round: true } });
      await tx.strike.create({ data: { userId: order.buyerId, listingId: order.listingId, orderId } });
      // Their "pay now" notice no longer applies.
      await tx.notification.deleteMany({ where: { userId: order.buyerId, key: notificationKey.won(order.listingId) } });
      const listing = await tx.listing.findUniqueOrThrow({ where: { id: order.listingId }, select: { reservePriceCents: true, pickupAddress: true } });

      // The next bidder, by their own highest bid, who has not already been offered this item, is not blocked from bidding and is not banned.
      // Bids only rise, so if the best remaining one is below the reserve, they all are.
      const [next] = await tx.$queryRaw<{ userId: string; amountCents: number }[]>`
        SELECT b."bidderId" AS "userId", MAX(b."amountCents")::int AS "amountCents"
        FROM "Bid" b
        WHERE b."listingId" = ${order.listingId}
          AND b."bidderId" NOT IN (SELECT "buyerId" FROM "Order" WHERE "listingId" = ${order.listingId})
          AND (SELECT COUNT(*) FROM "Strike" s WHERE s."userId" = b."bidderId") < ${MAX_STRIKES}
          AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = b."bidderId" AND u."bannedAt" IS NOT NULL)
        GROUP BY b."bidderId"
        ORDER BY MAX(b."amountCents") DESC
        LIMIT 1`;
      // The item is offered to at most MAX_PAYMENT_ROUNDS buyers; after the last one the auction ends without a sale.
      const qualifies = order.round < MAX_PAYMENT_ROUNDS && next && (listing.reservePriceCents === null || next.amountCents >= listing.reservePriceCents);

      // An email of the same kind still waiting from an earlier round is made due again rather than dropped, so this round is told too.
      for (const [userId, kind] of [[order.buyerId, "EXPIRED"], [order.sellerId, "NOT_PAID"]] as const) {
        await queueMail(tx, { userId, listingId: order.listingId, kind, dueAt: now });
      }

      if (qualifies) {
        offered = await offerItem(tx, { listingId: order.listingId, round: order.round + 1, buyerId: next.userId, sellerId: order.sellerId, amountCents: next.amountCents, pickupAddress: listing.pickupAddress, startedAt: now, mailDueAt: now });
        // The listing's result follows the sale: the new buyer and what they pay.
        await tx.listing.update({ where: { id: order.listingId }, data: { winnerId: next.userId, finalPriceCents: next.amountCents } });
      } else {
        await tx.listing.update({ where: { id: order.listingId }, data: { outcome: "NO_SALE", winnerId: null, finalPriceCents: null } });
      }
      return { orderId, listingId: order.listingId, nextBuyerId: qualifies ? next.userId : null, nextAmountCents: qualifies ? next.amountCents : null };
    });
    if (!result) return null;
    if (offered) await this.scheduler.scheduleOrderExpiry(offered.id, offered.payBy);

    const summary: ExpiryResult = { orderId: result.orderId, listingId: result.listingId, nextBuyerId: result.nextBuyerId, nextAmountCents: result.nextAmountCents };
    this.events.publish({ type: "OrderExpired", ...summary });
    return summary;
  }

  private async longOverdue(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { payBy: true } });
    return !!order && Date.now() - order.payBy.getTime() >= GIVE_UP_CHECKING_AFTER_MS;
  }

  // Expires whatever is waiting and past its deadline. Safe to run on every machine.
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let expired = 0;
    try {
      const due = await this.prisma.order.findMany({
        where: { status: "AWAITING_PAYMENT", payBy: { lte: new Date() }, id: { notIn: this.failed.skipping() } },
        orderBy: { payBy: "asc" },
        take: SWEEP_BATCH,
        select: { id: true },
      });
      for (const { id } of due) {
        try {
          if (await this.expire(id)) expired++;
        } catch (error) {
          this.failed.fail(id);
          this.log.error(`Could not expire order ${id}: ${(error as Error).message}`);
        }
      }
      if (expired > 0) this.log.log(`Expired ${expired} unpaid order${expired === 1 ? "" : "s"}`);
    } catch (error) {
      this.log.error(`Order expiry sweep failed: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
    return expired;
  }
}

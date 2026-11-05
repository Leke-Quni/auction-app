import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { payoutDelayDays } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider";

const SWEEP_EVERY_MS = 60_000;
const SWEEP_BATCH = 100;
// An order whose payout fails is left out of the sweep for this long, so a few broken ones cannot fill every batch.
const RETRY_FAILED_AFTER_MS = 10 * 60_000;

// Pays the seller their share (`sellerNetCents`: the price less the platform fee, never the delivery money) once the
// parcel has been delivered for PAYOUT_DELAY_DAYS. There is no early release. The provider pays once per order (its own
// idempotency key), and the Payout row is unique per order, so duplicate runs and several machines pay nothing twice: if
// the transfer went but saving the row failed, the next run gets the same transfer back and saves the row.
@Injectable()
export class PayoutService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PayoutService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private readonly failedUntil = new Map<string, number>();

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Returns true if this call paid the order, false if it did nothing (not due, no ready account, already paid).
  async release(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, status: "PAID", shipmentStatus: "DELIVERED", deliveredAt: { lte: new Date(Date.now() - payoutDelayDays() * 86_400_000) }, payout: null },
      select: { id: true, sellerId: true, listingId: true, sellerNetCents: true, paymentRef: true, seller: { select: { payoutAccountId: true } } },
    });
    if (!order || !order.paymentRef || !order.seller.payoutAccountId) return false;
    if (!(await this.payments.isPayoutAccountReady(order.seller.payoutAccountId))) return false;
    const { reference } = await this.payments.payout({
      orderId: order.id,
      sellerId: order.sellerId,
      accountId: order.seller.payoutAccountId,
      amountCents: order.sellerNetCents,
      paymentRef: order.paymentRef,
    });
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.payout.createMany({ data: { orderId: order.id, sellerId: order.sellerId, amountCents: order.sellerNetCents, reference }, skipDuplicates: true });
      if (saved.count === 0) return false;
      await tx.pendingEndEmail.upsert({
        where: { userId_listingId_kind: { userId: order.sellerId, listingId: order.listingId, kind: "PAYOUT" } },
        create: { userId: order.sellerId, listingId: order.listingId, kind: "PAYOUT" },
        update: {},
      });
      return true;
    });
  }

  // Pays whatever is due. Safe to run on every machine.
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let paid = 0;
    try {
      const now = Date.now();
      for (const [id, until] of this.failedUntil) if (until <= now) this.failedUntil.delete(id);
      const due = await this.prisma.order.findMany({
        where: {
          status: "PAID",
          shipmentStatus: "DELIVERED",
          deliveredAt: { lte: new Date(now - payoutDelayDays() * 86_400_000) },
          payout: null,
          seller: { payoutAccountId: { not: null } },
          id: { notIn: [...this.failedUntil.keys()] },
        },
        orderBy: { deliveredAt: "asc" },
        take: SWEEP_BATCH,
        select: { id: true },
      });
      for (const { id } of due) {
        try {
          if (await this.release(id)) paid++;
          // Due but not payable yet (the seller has not finished setting up their account): look again later, so a pile of
          // these cannot fill every batch or ask the provider about the same accounts every minute.
          else this.failedUntil.set(id, Date.now() + RETRY_FAILED_AFTER_MS);
        } catch (error) {
          this.failedUntil.set(id, Date.now() + RETRY_FAILED_AFTER_MS);
          this.log.error(`Could not pay out order ${id}: ${(error as Error).message}`);
        }
      }
      if (paid > 0) this.log.log(`Paid out ${paid} order${paid === 1 ? "" : "s"}`);
    } catch (error) {
      this.log.error(`Payout sweep failed: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
    return paid;
  }
}

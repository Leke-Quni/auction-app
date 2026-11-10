import { formatEur, PAYMENT_REMINDER_HOURS, SOCKET_EVENTS, type WonNotice } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { runEvery } from "../jobs/sweep-support";
import { timeLeft, utc } from "../email/format";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { notificationKey } from "../notifications/notification-keys";
import { Notify } from "./notify.service";
import { RealtimeGateway } from "./realtime.gateway";

const SWEEP_EVERY_MS = 60_000;
const BATCH = 50;
// A sweep that has claimed an order has this long to send before another may take over.
const LEASE_MINUTES = 5;

interface DueOrder {
  id: string;
  listingId: string;
  buyerId: string;
  amountCents: number;
  payBy: Date;
}

// Reminds a buyer once, when PAYMENT_REMINDER_HOURS are left to pay, that the item will be offered to someone else if the
// order is not paid: an email, a bell notice (it replaces the "you won" one, which has the same key, and shows as unread)
// and a live toast. The sweep finds orders still waiting for payment that are inside that window, so a restarted machine
// catches up, and a reminder is only ever sent while there is still time to pay. A sweep takes a lease on the order first
// (`payReminderClaimedAt`), so two machines never both send, and marks it sent (`payReminderSentAt`) only after the email has
// gone: if the machine stops in between, the lease runs out and the next sweep sends it. A failed email gives the lease back.
// Buyers who are banned are not written to. The notice and toast follow the email and are best effort.
@Injectable()
export class PaymentReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaymentReminderService.name);
  private stop?: () => void;
  private running?: Promise<number>;

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly notify: Notify,
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  onModuleInit() {
    this.stop = runEvery(SWEEP_EVERY_MS, () => this.sweep());
    void this.sweep();
  }

  onModuleDestroy() {
    this.stop?.();
  }

  // A call while a sweep is under way waits for it and then makes a pass of its own, so it never returns before the orders
  // that were due when it was called have been handled.
  async sweep(): Promise<number> {
    while (this.running) await this.running;
    const run = this.pass().finally(() => {
      if (this.running === run) this.running = undefined;
    });
    this.running = run;
    return run;
  }

  private async pass(): Promise<number> {
    let sent = 0;
    try {
      const due = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Order"
        WHERE "status" = 'AWAITING_PAYMENT' AND "payReminderSentAt" IS NULL
          AND ("payReminderClaimedAt" IS NULL OR "payReminderClaimedAt" < clock_timestamp() - ${LEASE_MINUTES} * interval '1 minute')
          AND "payBy" > clock_timestamp() AND "payBy" <= clock_timestamp() + ${PAYMENT_REMINDER_HOURS} * interval '1 hour'
          AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Order"."buyerId" AND u."bannedAt" IS NOT NULL)
        ORDER BY "payBy" LIMIT ${BATCH}`;
      for (const { id } of due) {
        try {
          if (await this.remind(id)) sent++;
        } catch (error) {
          this.log.error(`Could not send the payment reminder for order ${id}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.log.error(`Payment reminder sweep failed: ${(error as Error).message}`);
    }
    return sent;
  }

  // Returns true when this call sent the reminder.
  private async remind(orderId: string): Promise<boolean> {
    const [order] = await this.prisma.$queryRaw<DueOrder[]>`
      UPDATE "Order" SET "payReminderClaimedAt" = clock_timestamp()
      WHERE "id" = ${orderId} AND "status" = 'AWAITING_PAYMENT' AND "payReminderSentAt" IS NULL
        AND ("payReminderClaimedAt" IS NULL OR "payReminderClaimedAt" < clock_timestamp() - ${LEASE_MINUTES} * interval '1 minute')
        AND "payBy" > clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "Order"."buyerId" AND u."bannedAt" IS NOT NULL)
      RETURNING "id", "listingId", "buyerId", "amountCents", "payBy"`;
    if (!order) return false;
    try {
      const [listing, buyer] = await Promise.all([
        this.prisma.listing.findUnique({ where: { id: order.listingId }, select: { title: true } }),
        this.prisma.user.findUnique({ where: { id: order.buyerId }, select: { email: true } }),
      ]);
      if (!listing || !buyer) {
        // Cannot happen while orders keep their listing and buyer (both are restricted), but never retry forever if it does.
        await this.markSent(orderId);
        return false;
      }
      const left = timeLeft(order.payBy.getTime() - Date.now());
      await this.mail.send(
        buyer.email,
        `${left} left to pay for ${listing.title}`,
        [
          `You have about ${left} left to pay for "${listing.title}" (${formatEur(order.amountCents)}).`,
          "",
          `Please pay by ${utc(order.payBy)}. If you do not, the item will be offered to someone else, and you will get a strike. Two strikes mean you can no longer bid.`,
          "",
          `Pay now: ${webUrl()}/orders/${order.id}`,
        ].join("\n"),
      );
      await this.markSent(orderId);
      const notice: WonNotice = { listingId: order.listingId, title: listing.title, finalPriceCents: order.amountCents, orderId: order.id, reminder: true };
      await this.notify.saveAndAnnounce([order.buyerId], { type: "WON", key: notificationKey.won(order.listingId), listingId: order.listingId, title: listing.title, data: notice });
      this.gateway.emitToUsers([order.buyerId], SOCKET_EVENTS.wonNotice, notice);
      return true;
    } catch (error) {
      // The email did not go: give the lease back so the next sweep tries again while there is still time to pay.
      await this.prisma.order.updateMany({ where: { id: orderId, payReminderSentAt: null }, data: { payReminderClaimedAt: null } });
      throw error;
    }
  }

  private markSent(orderId: string) {
    return this.prisma.order.updateMany({ where: { id: orderId, payReminderSentAt: null }, data: { payReminderSentAt: new Date() } });
  }
}

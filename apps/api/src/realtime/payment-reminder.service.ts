import { formatEur, PAYMENT_REMINDER_HOURS, SOCKET_EVENTS, type UnreadEvent, type WonNotice } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { timeLeft, utc } from "../email/format";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { SavedNotificationsService } from "../notifications/saved-notifications.service";
import { RealtimeGateway } from "./realtime.gateway";

const SWEEP_EVERY_MS = 60_000;
const BATCH = 50;

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
// catches up, and a reminder is only ever sent while there is still time to pay. A claim marks the order first, so two
// machines never both send; the email goes before the notice, and a failed email gives the claim back for the next sweep.
@Injectable()
export class PaymentReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaymentReminderService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly saved: SavedNotificationsService,
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
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
          AND "payBy" > clock_timestamp() AND "payBy" <= clock_timestamp() + ${PAYMENT_REMINDER_HOURS} * interval '1 hour'
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
      UPDATE "Order" SET "payReminderSentAt" = clock_timestamp()
      WHERE "id" = ${orderId} AND "status" = 'AWAITING_PAYMENT' AND "payReminderSentAt" IS NULL AND "payBy" > clock_timestamp()
      RETURNING "id", "listingId", "buyerId", "amountCents", "payBy"`;
    if (!order) return false;
    try {
      const [listing, buyer] = await Promise.all([
        this.prisma.listing.findUnique({ where: { id: order.listingId }, select: { title: true } }),
        this.prisma.user.findUnique({ where: { id: order.buyerId }, select: { email: true } }),
      ]);
      if (!listing || !buyer) return false;
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
      const notice: WonNotice = { listingId: order.listingId, title: listing.title, finalPriceCents: order.amountCents, orderId: order.id, reminder: true };
      try {
        const unread = await this.saved.save([order.buyerId], { type: "WON", key: `won:${order.listingId}`, listingId: order.listingId, title: listing.title, data: notice });
        for (const [userId, unreadCount] of unread) this.gateway.emitToUsers([userId], SOCKET_EVENTS.unread, { unreadCount } satisfies UnreadEvent);
        this.gateway.emitToUsers([order.buyerId], SOCKET_EVENTS.wonNotice, notice);
      } catch (error) {
        this.log.error(`Could not save the payment reminder notice for order ${order.id}: ${(error as Error).message}`);
      }
      return true;
    } catch (error) {
      // Nothing went out: give the claim back so the next sweep tries again while there is still time to pay.
      await this.prisma.order.updateMany({ where: { id: orderId, status: "AWAITING_PAYMENT" }, data: { payReminderSentAt: null } });
      throw error;
    }
  }
}

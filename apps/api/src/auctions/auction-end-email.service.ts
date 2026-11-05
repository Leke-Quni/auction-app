import { formatEur, MAX_PAYMENT_ROUNDS, MAX_STRIKES, type ShippingAddress } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { AuctionEvents } from "../bids/auction-events";
import { webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { utc } from "../email/format";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { addressLines, deliveryOf, invoiceDataOf, renderInvoice } from "../orders/invoice";

const SWEEP_EVERY_MS = 30_000;
// A send holds its row this long; if the machine stops mid-send the row comes due again afterwards.
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
// Reminders are the least urgent mail, so a sweep sends only a few; a burst of them (everyone watching one popular auction)
// never holds up the pay-now and payment emails that share this queue, and the rest go out on the next sweeps.
const REMINDER_BATCH = 25;
type EndEmailKind = "LOST" | "WON" | "PAID" | "SOLD" | "EXPIRED" | "NOT_PAID" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "PAYOUT" | "ENDING_SOON";

// Sends every bidder who did not win one email when the auction ends, with the final price. The rows are written by the
// close itself (see AuctionCloseService), so this only has to send what is due: a row is claimed by moving its due time
// out (a lease) and deleted only after the email has gone, so a failed send or a machine that stopped mid-send is tried
// again, up to MAX_ATTEMPTS times. Safe to run on several machines.
// A stable form of an address for comparing two of them: the same parts in the same order.
const sortedKeys = (value: unknown) => Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));

// "3 days", "5 hours" or "40 minutes", rounded to the nearest whole unit.
const timeLeft = (ms: number) => {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (ms >= 48 * 3600_000) return plural(Math.round(ms / (24 * 3600_000)), "day");
  if (ms >= 2 * 3600_000) return plural(Math.round(ms / 3600_000), "hour");
  return plural(Math.max(1, Math.round(ms / 60_000)), "minute");
};

@Injectable()
export class AuctionEndEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AuctionEndEmailService.name);
  private timer?: ReturnType<typeof setInterval>;
  private subscription?: Subscription;
  private running?: Promise<void>;
  private again = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    private readonly events: AuctionEvents,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
    this.subscription = this.events.stream.subscribe((event) => {
      if (event.type === "AuctionClosed" || event.type === "OrderExpired") void this.sweep();
    });
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    this.subscription?.unsubscribe();
  }

  // A call while a sweep is under way makes it go round once more when it finishes (rows written after it started would
  // otherwise wait for the next timer), and resolves when that is done.
  sweep(): Promise<void> {
    this.again = this.running !== undefined;
    this.running ??= this.loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async loop() {
    do {
      this.again = false;
      await this.run();
    } while (this.again);
  }

  private async run() {
    try {
      const now = new Date();
      const [urgent, reminders] = await Promise.all([
        this.prisma.pendingEndEmail.findMany({ where: { dueAt: { lte: now }, kind: { not: "ENDING_SOON" } }, orderBy: { dueAt: "asc" }, take: 100 }),
        this.prisma.pendingEndEmail.findMany({ where: { dueAt: { lte: now }, kind: "ENDING_SOON" }, orderBy: { dueAt: "asc" }, take: REMINDER_BATCH }),
      ]);
      for (const candidate of [...urgent, ...reminders]) {
        const claimed = await this.prisma.$queryRaw<{ id: string; userId: string; listingId: string; kind: EndEmailKind; attempts: number }[]>`
          UPDATE "PendingEndEmail" SET "dueAt" = ${new Date(Date.now() + LEASE_MS)}, "attempts" = "attempts" + 1
          WHERE "id" = ${candidate.id} AND "dueAt" <= ${new Date()}
          RETURNING "id", "userId", "listingId", "kind", "attempts"`;
        const pending = claimed[0];
        if (!pending) continue; // another machine got it
        if (pending.attempts > MAX_ATTEMPTS) {
          this.log.error(`Giving up on an auction-ended email for ${pending.userId} on ${pending.listingId} after ${MAX_ATTEMPTS} tries`);
          await this.prisma.pendingEndEmail.deleteMany({ where: { id: pending.id } });
          continue;
        }
        try {
          await this.send(pending.userId, pending.listingId, pending.kind);
          await this.prisma.pendingEndEmail.deleteMany({ where: { id: pending.id } });
        } catch (error) {
          this.log.error(`Could not email an auction-ended notice (try ${pending.attempts} of ${MAX_ATTEMPTS}): ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.log.error(`Could not sweep auction-ended emails: ${(error as Error).message}`);
    }
  }

  // Returns normally when the email was sent or is no longer needed; throws when it should be tried again.
  private async send(userId: string, listingId: string, kind: EndEmailKind) {
    if (kind === "PAID" || kind === "SOLD") return this.sendPaid(userId, listingId, kind);
    if (kind === "EXPIRED" || kind === "NOT_PAID") return this.sendExpired(userId, listingId, kind);
    if (kind === "PAYOUT") return this.sendPayout(userId, listingId);
    if (kind === "ENDING_SOON") return this.sendEndingSoon(userId, listingId);
    if (kind === "SHIPPED" || kind === "IN_TRANSIT" || kind === "DELIVERED") return this.sendShipping(userId, listingId, kind);
    const [listing, user] = await Promise.all([
      this.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, outcome: true, currentBidCents: true, finalPriceCents: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!listing || !user || listing.outcome === "NO_BIDS") return;
    if (!listing.outcome) throw new Error("the auction's result is not saved yet"); // tried again, not dropped
    if (kind === "WON") return this.sendWon(user.email, userId, listingId, listing.title);
    const lines =
      listing.outcome === "SOLD"
        ? [`The auction for "${listing.title}" has ended, and you did not win it.`, "", `Final price: ${formatEur(listing.finalPriceCents ?? listing.currentBidCents ?? 0)}`]
        : [`The auction for "${listing.title}" has ended without a sale, because the reserve price was not met.`, "", `Highest bid: ${formatEur(listing.currentBidCents ?? 0)}`];
    lines.push("", `${webUrl()}/listings/${listingId}`);
    await this.mail.send(user.email, `${listing.title} has ended`, lines.join("\n"));
  }

  // The winner's email: what they won, what they owe and until when, and the link to pay.
  private async sendWon(to: string, userId: string, listingId: string, title: string) {
    const order = await this.prisma.order.findFirst({ where: { listingId, buyerId: userId }, orderBy: { round: "desc" } });
    if (!order || order.status !== "AWAITING_PAYMENT") return; // already paid, or no longer theirs to pay
    // A later round means the buyer before did not pay, so this is an offer at the bidder's own highest bid, not a win.
    const offered = order.round > 1;
    const lines = [
      offered
        ? `The buyer who won "${title}" did not pay in time, so the item is now offered to you at your highest bid of ${formatEur(order.amountCents)}.`
        : `You won "${title}" with a bid of ${formatEur(order.amountCents)}.`,
      "",
      `Please pay by ${utc(order.payBy)}. After that the item may be offered to the next bidder${offered ? " or the auction may end without a sale" : ""}.`,
      "",
      `Pay now: ${webUrl()}/orders/${order.id}`,
    ];
    await this.mail.send(to, offered ? `${title} is yours if you pay: pay now` : `You won ${title}: pay now`, lines.join("\n"));
  }

  // After payment. The buyer gets the confirmation with the invoice attached and the delivery details; the seller is told
  // what to ship and where. The order is found by the person and the listing (a listing has one paid order).
  private async sendPaid(userId: string, listingId: string, kind: "PAID" | "SOLD") {
    const order = await this.prisma.order.findFirst({
      where: { listingId, status: "PAID", ...(kind === "PAID" ? { buyerId: userId } : { sellerId: userId }) },
      include: { listing: { select: { title: true } }, buyer: { select: { email: true, username: true } }, seller: { select: { email: true, username: true, pickupAddress: true } } },
    });
    if (!order) return; // not paid after all, or no longer theirs
    const data = invoiceDataOf(order, kind === "PAID" ? "buyer" : "seller");
    const delivery = deliveryOf(order);
    if (!data || !delivery) throw new Error("the paid order's invoice details are not saved yet"); // tried again, not dropped
    const service = `${delivery.name}, about ${delivery.estimatedDays} days${delivery.tracked ? ", tracked" : ""}${delivery.insured ? ", insured" : ""}`;
    if (kind === "SOLD") {
      const pickup = order.pickupAddress as ShippingAddress | null;
      const differs = !!pickup && JSON.stringify(sortedKeys(pickup)) !== JSON.stringify(sortedKeys(order.seller.pickupAddress));
      const lines = [
        `"${order.listing.title}" has been paid for by ${order.buyer.username}. Our carrier will collect it from:`,
        "",
        ...(pickup ? addressLines(pickup) : ["(no pickup address saved: we will contact you)"]),
        "",
        ...(differs
          ? ["", "This is not your default pickup address, so please check it is right. A wrong street or phone number means the carrier cannot collect."]
          : []),
        "",
        "Please have the item packed and ready, and keep your phone on: the carrier calls before coming.",
        `Wrong address? Correct it here before the carrier comes: ${webUrl()}/orders/${order.id}`,
        `Delivery: ${service}, to ${delivery.address.city}.`,
        "",
        `Price: ${formatEur(order.amountCents)}. You receive ${formatEur(order.sellerNetCents)} after the ${formatEur(order.feeCents)} platform fee.`,
        "",
        `${webUrl()}/orders/${order.id}`,
      ];
      await this.mail.send(order.seller.email, `Sold: get ${order.listing.title} ready for collection`, lines.join("\n"), [{ filename: `${data.invoiceNumber}.pdf`, content: await renderInvoice(data) }]);
      return;
    }
    const lines = [
      `Payment completed. Thank you for buying "${order.listing.title}".`,
      "",
      `Invoice ${data.invoiceNumber}`,
      `  Item:     ${formatEur(order.amountCents)}`,
      `  Delivery: ${formatEur(delivery.priceCents)} (${service})`,
      `  Total paid: ${formatEur(data.totalCents)}`,
      "",
      "Delivering to:",
      ...addressLines(delivery.address as ShippingAddress),
      "",
      "The invoice is attached as a PDF.",
      `${webUrl()}/orders/${order.id}`,
    ];
    await this.mail.send(order.buyer.email, `Payment completed: ${order.listing.title}`, lines.join("\n"), [{ filename: `${data.invoiceNumber}.pdf`, content: await renderInvoice(data) }]);
  }

  // One reminder, about 24 hours before a watched auction ends. Nothing is sent if the person stopped watching, the auction is
  // over or already closed, or they are the one winning it anyway.
  private async sendEndingSoon(userId: string, listingId: string) {
    const [watch, listing, user] = await Promise.all([
      this.prisma.watch.findUnique({ where: { userId_listingId: { userId, listingId } }, select: { userId: true } }),
      this.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, status: true, endsAt: true, closedAt: true, sellerId: true, highBidderId: true, currentBidCents: true, startingPriceCents: true, bidCount: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!watch || !listing || !user || listing.status !== "PUBLISHED" || !listing.endsAt || listing.closedAt) return;
    if (listing.endsAt.getTime() <= Date.now() || listing.sellerId === userId || listing.highBidderId === userId) return;
    const lines = [
      // Said from the clock, not from the plan: a reminder held up by a stopped machine or a retry must not claim a day is left.
      `"${listing.title}", which you are watching, ends in about ${timeLeft(listing.endsAt.getTime() - Date.now())}.`,
      "",
      `Ends: ${utc(listing.endsAt)}`,
      listing.bidCount > 0 ? `Current bid: ${formatEur(listing.currentBidCents ?? listing.startingPriceCents)} (${listing.bidCount} ${listing.bidCount === 1 ? "bid" : "bids"})` : `Starting price: ${formatEur(listing.startingPriceCents)}, no bids yet`,
      "",
      `${webUrl()}/listings/${listingId}`,
    ];
    await this.mail.send(user.email, `Ending soon: ${listing.title}`, lines.join("\n"));
  }

  // The seller's share has been paid out.
  private async sendPayout(userId: string, listingId: string) {
    const order = await this.prisma.order.findFirst({
      where: { listingId, sellerId: userId, payout: { isNot: null } },
      include: { listing: { select: { title: true } }, seller: { select: { email: true } }, payout: true },
    });
    if (!order?.payout) return;
    const title = order.listing.title;
    const lines = [
      `Your payout for "${title}" has been sent: ${formatEur(order.payout.amountCents)}.`,
      "",
      `That is the ${formatEur(order.amountCents)} price less the ${formatEur(order.feeCents)} platform fee.`,
      `Reference: ${order.payout.reference}`,
      "",
      `${webUrl()}/orders/${order.id}`,
    ];
    await this.mail.send(order.seller.email, `You have been paid for ${title}`, lines.join("\n"));
  }

  // The buyer's shipping updates: the seller handed the item over, the carrier has it, it was delivered. Sent only while the
  // parcel is at that stage or later, and the tracking code is always the order's own.
  private async sendShipping(userId: string, listingId: string, kind: "SHIPPED" | "IN_TRANSIT" | "DELIVERED") {
    const order = await this.prisma.order.findFirst({
      where: { listingId, buyerId: userId, status: "PAID", shipmentStatus: { not: null } },
      include: { listing: { select: { title: true } }, buyer: { select: { email: true } } },
    });
    if (!order?.trackingCode) return;
    const title = order.listing.title;
    const delivery = deliveryOf(order);
    const text: Record<typeof kind, [string, string]> = {
      SHIPPED: [`${title} is on its way`, `The seller has handed "${title}" to our carrier. The label is created and the parcel will be collected shortly.`],
      IN_TRANSIT: [`${title} is in transit`, `The carrier has "${title}" and it is on its way to you${delivery ? ` (about ${delivery.estimatedDays} days in all)` : ""}.`],
      DELIVERED: [`${title} was delivered`, `"${title}" has been delivered. We hope you enjoy it!`],
    };
    const [subject, line] = text[kind];
    await this.mail.send(order.buyer.email, subject, [line, "", `Tracking code: ${order.trackingCode}`, "", `${webUrl()}/orders/${order.id}`].join("\n"));
  }

  // When a buyer did not pay in time. The buyer is told they were struck and what that means; the seller is told what happens
  // to the item next (offered to the next bidder, or the auction ends without a sale).
  private async sendExpired(userId: string, listingId: string, kind: "EXPIRED" | "NOT_PAID") {
    const order = await this.prisma.order.findFirst({
      where: { listingId, status: "EXPIRED", ...(kind === "EXPIRED" ? { buyerId: userId } : { sellerId: userId }) },
      orderBy: { round: "desc" },
      include: { listing: { select: { title: true } }, buyer: { select: { email: true, username: true } }, seller: { select: { email: true } } },
    });
    if (!order) return;
    const title = order.listing.title;
    if (kind === "EXPIRED") {
      // The count as it was when this order expired, not as it is now, so a late or retried email does not skip ahead.
      const given = await this.prisma.strike.findUnique({ where: { orderId: order.id }, select: { createdAt: true } });
      const strikes = await this.prisma.strike.count({ where: { userId, ...(given ? { createdAt: { lte: given.createdAt } } : {}) } });
      const lines = [
        `You did not pay for "${title}" (${formatEur(order.amountCents)}) within the payment window, so the order has been cancelled.`,
        "",
        strikes >= MAX_STRIKES
          ? `That is strike ${strikes} on your account, so you can no longer place bids.`
          : `That is strike ${strikes} of ${MAX_STRIKES} on your account. At ${MAX_STRIKES} strikes you can no longer place bids.`,
        "",
        "If you were charged after the order expired, the payment is refunded automatically.",
      ];
      await this.mail.send(order.buyer.email, `You did not pay for ${title} in time`, lines.join("\n"));
      return;
    }
    const next = await this.prisma.order.findFirst({ where: { listingId, round: order.round + 1 }, include: { buyer: { select: { username: true } } } });
    const lines = [
      `${order.buyer.username} won "${title}" at ${formatEur(order.amountCents)} but did not pay within the payment window, so that order was cancelled and they received a strike.`,
      "",
      next
        ? `We have offered the item to the next bidder, ${next.buyer.username}, at their highest bid of ${formatEur(next.amountCents)}. They have until ${utc(next.payBy)} to pay. We will tell you if they do not.`
        : order.round >= MAX_PAYMENT_ROUNDS
          ? `The item was offered to ${MAX_PAYMENT_ROUNDS} buyers and none of them paid, so the auction ended without a sale. You can list the item again.`
          : "No other bidder qualified (a remaining bid has to meet the reserve price, if there is one), so the auction ended without a sale. You can list the item again.",
      "",
      `${webUrl()}/listings/${listingId}`,
    ];
    await this.mail.send(order.seller.email, next ? `${order.buyer.username} did not pay for ${title}: offered to the next bidder` : `${order.buyer.username} did not pay for ${title}: no sale`, lines.join("\n"));
  }
}

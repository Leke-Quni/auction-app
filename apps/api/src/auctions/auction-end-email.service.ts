import { formatEur, type ShippingAddress } from "@auction/shared";
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

// Sends every bidder who did not win one email when the auction ends, with the final price. The rows are written by the
// close itself (see AuctionCloseService), so this only has to send what is due: a row is claimed by moving its due time
// out (a lease) and deleted only after the email has gone, so a failed send or a machine that stopped mid-send is tried
// again, up to MAX_ATTEMPTS times. Safe to run on several machines.
// A stable form of an address for comparing two of them: the same parts in the same order.
const sortedKeys = (value: unknown) => Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));

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
      if (event.type === "AuctionClosed") void this.sweep();
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
      const due = await this.prisma.pendingEndEmail.findMany({ where: { dueAt: { lte: new Date() } }, orderBy: { dueAt: "asc" }, take: 100 });
      for (const candidate of due) {
        const claimed = await this.prisma.$queryRaw<{ id: string; userId: string; listingId: string; kind: "LOST" | "WON" | "PAID" | "SOLD"; attempts: number }[]>`
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
  private async send(userId: string, listingId: string, kind: "LOST" | "WON" | "PAID" | "SOLD") {
    if (kind === "PAID" || kind === "SOLD") return this.sendPaid(userId, listingId, kind);
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
    const lines = [
      `You won "${title}" with a bid of ${formatEur(order.amountCents)}.`,
      "",
      `Please pay by ${utc(order.payBy)}. After that the item may be offered to the next bidder.`,
      "",
      `Pay now: ${webUrl()}/orders/${order.id}`,
    ];
    await this.mail.send(to, `You won ${title}: pay now`, lines.join("\n"));
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
}

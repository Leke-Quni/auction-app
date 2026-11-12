import { formatEur, MAX_PAYMENT_ROUNDS, MAX_STRIKES, SUSPENDED_ORDER_DAYS, type ShippingAddress } from "@auction/shared";
import { webUrl } from "../config";
import type { Prisma } from "../db/db.module";
import { addressLines, deliveryOf, invoiceDataOf, renderInvoice } from "../orders/invoice";
import { timeLeft, utc } from "./format";
import type { MailSender } from "./mail-sender";
import type { OutboxKind } from "./mail-outbox";

type Ctx = { prisma: Prisma; mail: MailSender };

// A stable form of an address for comparing two of them: the same parts in the same order.
const sortedKeys = (value: unknown) => Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));

// Returns normally when the email was sent or is no longer needed; throws when it should be tried again.
export async function sendOutboxMail(ctx: Ctx, userId: string, listingId: string, kind: OutboxKind) {
  if (kind === "PAID" || kind === "SOLD") return sendPaid(ctx, userId, listingId, kind);
  if (kind === "EXPIRED" || kind === "NOT_PAID") return sendExpired(ctx, userId, listingId, kind);
  if (kind === "PAYOUT") return sendPayout(ctx, userId, listingId);
  if (kind === "REMOVED") return sendRemoved(ctx, userId, listingId);
  if (kind === "SELLER_SUSPENDED" || kind === "ORDER_CANCELLED") return sendSuspendedSale(ctx, userId, listingId, kind);
  if (kind === "ENDING_SOON") return sendEndingSoon(ctx, userId, listingId);
  if (kind === "SHIPPED" || kind === "IN_TRANSIT" || kind === "DELIVERED") return sendShipping(ctx, userId, listingId, kind);
  const [listing, user] = await Promise.all([
    ctx.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, outcome: true, currentBidCents: true, finalPriceCents: true, removedAt: true } }),
    ctx.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);
  if (!listing || !user || listing.outcome === "NO_BIDS") return;
  if (!listing.outcome) throw new Error("the auction's result is not saved yet"); // tried again, not dropped
  if (kind === "WON") return sendWon(ctx, user.email, userId, listingId, listing.title);
  const lines = listing.removedAt
    ? [`The auction for "${listing.title}" was ended early by a moderator and nobody won it. Your bid does not need to be paid.`]
    : listing.outcome === "SOLD"
      ? [`The auction for "${listing.title}" has ended, and you did not win it.`, "", `Final price: ${formatEur(listing.finalPriceCents ?? listing.currentBidCents ?? 0)}`]
      : [`The auction for "${listing.title}" has ended without a sale, because the reserve price was not met.`, "", `Highest bid: ${formatEur(listing.currentBidCents ?? 0)}`];
  lines.push("", `${webUrl()}/listings/${listingId}`);
  await ctx.mail.send(user.email, `${listing.title} has ended`, lines.join("\n"));
}

// The winner's email: what they won, what they owe and until when, and the link to pay.
async function sendWon(ctx: Ctx, to: string, userId: string, listingId: string, title: string) {
  const order = await ctx.prisma.order.findFirst({ where: { listingId, buyerId: userId }, orderBy: { round: "desc" } });
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
  await ctx.mail.send(to, offered ? `${title} is yours if you pay: pay now` : `You won ${title}: pay now`, lines.join("\n"));
}

// After payment. The buyer gets the confirmation with the invoice attached and the delivery details; the seller is told
// what to ship and where. The order is found by the person and the listing (a listing has one paid order).
async function sendPaid(ctx: Ctx, userId: string, listingId: string, kind: "PAID" | "SOLD") {
  const order = await ctx.prisma.order.findFirst({
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
    await ctx.mail.send(order.seller.email, `Sold: get ${order.listing.title} ready for collection`, lines.join("\n"), [{ filename: `${data.invoiceNumber}.pdf`, content: await renderInvoice(data) }]);
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
  await ctx.mail.send(order.buyer.email, `Payment completed: ${order.listing.title}`, lines.join("\n"), [{ filename: `${data.invoiceNumber}.pdf`, content: await renderInvoice(data) }]);
}

// One reminder, about 24 hours before a watched auction ends. Nothing is sent if the person stopped watching, the auction is
// over or already closed, or they are the one winning it anyway.
async function sendEndingSoon(ctx: Ctx, userId: string, listingId: string) {
  const [watch, listing, user] = await Promise.all([
    ctx.prisma.watch.findUnique({ where: { userId_listingId: { userId, listingId } }, select: { userId: true } }),
    ctx.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, status: true, endsAt: true, closedAt: true, sellerId: true, highBidderId: true, currentBidCents: true, startingPriceCents: true, bidCount: true } }),
    ctx.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);
  if (!watch || !listing || !user || listing.status !== "PUBLISHED" || !listing.endsAt || listing.closedAt) return;
  if (listing.endsAt.getTime() <= Date.now() || listing.sellerId === userId || listing.highBidderId === userId) return;
  const lines = [
    // Said from the clock, not from the plan: a reminder held up by a stopped machine or a retry must not claim a day is left.
    `"${listing.title}", which you are watching, ends in about ${timeLeft(listing.endsAt.getTime() - Date.now())}.`,
    "",
    `Ends: ${utc(listing.endsAt)}`,
    listing.bidCount > 0 ? `Current highest bid: ${formatEur(listing.currentBidCents ?? listing.startingPriceCents)} (${listing.bidCount} ${listing.bidCount === 1 ? "bid" : "bids"})` : `Starting price: ${formatEur(listing.startingPriceCents)}, no bids yet`,
    "",
    `${webUrl()}/listings/${listingId}`,
  ];
  await ctx.mail.send(user.email, `Ending soon: ${listing.title}`, lines.join("\n"));
}

// The seller's notice that a moderator ended their auction, with the reason the moderator gave.
async function sendRemoved(ctx: Ctx, userId: string, listingId: string) {
  const [listing, user] = await Promise.all([
    ctx.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, removedAt: true, removalReason: true, sellerId: true } }),
    ctx.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);
  if (!listing?.removedAt || listing.sellerId !== userId || !user) return;
  const lines = [
    `A moderator ended your auction "${listing.title}" early. It has no winner and nobody has to pay.`,
    "",
    `Reason: ${listing.removalReason ?? "not given"}`,
    "",
    "The listing stays on the site as a record and cannot be listed again.",
    "",
    `${webUrl()}/listings/${listingId}`,
  ];
  await ctx.mail.send(user.email, `Your listing "${listing.title}" was removed`, lines.join("\n"));
}

// The seller's share has been paid out.
async function sendPayout(ctx: Ctx, userId: string, listingId: string) {
  const order = await ctx.prisma.order.findFirst({
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
  await ctx.mail.send(order.seller.email, `You have been paid for ${title}`, lines.join("\n"));
}

// The buyer's shipping updates: the seller handed the item over, the carrier has it, it was delivered. Sent only while the
// parcel is at that stage or later, and the tracking code is always the order's own.
async function sendShipping(ctx: Ctx, userId: string, listingId: string, kind: "SHIPPED" | "IN_TRANSIT" | "DELIVERED") {
  const order = await ctx.prisma.order.findFirst({
    where: { listingId, buyerId: userId, status: "PAID", shipmentStatus: { not: null } },
    include: { listing: { select: { title: true } }, buyer: { select: { email: true } } },
  });
  if (!order?.trackingCode) return;
  // A retry that comes due after the parcel has moved on would say "on its way" after "delivered": the later email covers it.
  const stage = { SHIPPED: "LABEL_CREATED", IN_TRANSIT: "IN_TRANSIT", DELIVERED: "DELIVERED" } as const;
  if (order.shipmentStatus !== stage[kind]) return;
  const title = order.listing.title;
  const delivery = deliveryOf(order);
  const text: Record<typeof kind, [string, string]> = {
    SHIPPED: [`${title} is on its way`, `The seller has handed "${title}" to our carrier. The label is created and the parcel will be collected shortly.`],
    IN_TRANSIT: [`${title} is in transit`, `The carrier has "${title}" and it is on its way to you${delivery ? ` (about ${delivery.estimatedDays} days in all)` : ""}.`],
    DELIVERED: [`${title} was delivered`, `"${title}" has been delivered. We hope you enjoy it!`],
  };
  const [subject, line] = text[kind];
  await ctx.mail.send(order.buyer.email, subject, [line, "", `Tracking code: ${order.trackingCode}`, "", `${webUrl()}/orders/${order.id}`].join("\n"));
}

// A banned seller's unpaid order: the buyer is told it is paused (when the ban happens), and later that it was cancelled (when
// the ban has lasted SUSPENDED_ORDER_DAYS). Either way nothing is charged and nothing counts against the buyer. Not sent when the
// order has moved on since (paid, restored, or already told).
async function sendSuspendedSale(ctx: Ctx, userId: string, listingId: string, kind: "SELLER_SUSPENDED" | "ORDER_CANCELLED") {
  const order = await ctx.prisma.order.findFirst({
    where: { listingId, buyerId: userId },
    orderBy: { round: "desc" },
    include: { listing: { select: { title: true } }, buyer: { select: { email: true } }, seller: { select: { bannedAt: true } } },
  });
  if (!order) return;
  const title = order.listing.title;
  if (kind === "SELLER_SUSPENDED") {
    if (order.status !== "AWAITING_PAYMENT" || !order.seller.bannedAt) return; // paid, cancelled, or the ban is already lifted
    const lines = [
      `The seller of "${title}" (${formatEur(order.amountCents)}) has had their account suspended, so your order is paused.`,
      "",
      "You do not need to pay now, you will not be charged, and nothing counts against you.",
      "",
      `If the suspension is lifted, you will have the full time to pay again and we will remind you. If it lasts ${SUSPENDED_ORDER_DAYS} days, the order is cancelled and we will tell you.`,
      "",
      `${webUrl()}/orders/${order.id}`,
    ];
    await ctx.mail.send(order.buyer.email, `Your order for ${title} is paused`, lines.join("\n"));
    return;
  }
  if (order.status !== "CANCELLED") return;
  const lines = [
    `Your order for "${title}" (${formatEur(order.amountCents)}) could not go ahead: the seller's account stayed suspended for ${SUSPENDED_ORDER_DAYS} days, so the order has been cancelled.`,
    "",
    "You were not charged, and this does not count against you.",
  ];
  await ctx.mail.send(order.buyer.email, `Your order for ${title} was cancelled`, lines.join("\n"));
}

// When a buyer did not pay in time. The buyer is told they were struck and what that means; the seller is told what happens
// to the item next (offered to the next bidder, or the auction ends without a sale).
async function sendExpired(ctx: Ctx, userId: string, listingId: string, kind: "EXPIRED" | "NOT_PAID") {
  const order = await ctx.prisma.order.findFirst({
    where: { listingId, status: "EXPIRED", ...(kind === "EXPIRED" ? { buyerId: userId } : { sellerId: userId }) },
    orderBy: { round: "desc" },
    include: { listing: { select: { title: true } }, buyer: { select: { email: true, username: true } }, seller: { select: { email: true } } },
  });
  if (!order) return;
  const title = order.listing.title;
  if (kind === "EXPIRED") {
    // The count as it was when this order expired, not as it is now, so a late or retried email does not skip ahead.
    const given = await ctx.prisma.strike.findUnique({ where: { orderId: order.id }, select: { createdAt: true } });
    const strikes = await ctx.prisma.strike.count({ where: { userId, ...(given ? { createdAt: { lte: given.createdAt } } : {}) } });
    const lines = [
      `You did not pay for "${title}" (${formatEur(order.amountCents)}) within the payment window, so the order has been cancelled.`,
      "",
      strikes >= MAX_STRIKES
        ? `That is strike ${strikes} on your account, so you can no longer place bids.`
        : `That is strike ${strikes} of ${MAX_STRIKES} on your account. At ${MAX_STRIKES} strikes you can no longer place bids.`,
      "",
      "If you were charged after the order expired, the payment is refunded automatically.",
    ];
    await ctx.mail.send(order.buyer.email, `You did not pay for ${title} in time`, lines.join("\n"));
    return;
  }
  const next = await ctx.prisma.order.findFirst({ where: { listingId, round: order.round + 1 }, include: { buyer: { select: { username: true } } } });
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
  await ctx.mail.send(order.seller.email, next ? `${order.buyer.username} did not pay for ${title}: offered to the next bidder` : `${order.buyer.username} did not pay for ${title}: no sale`, lines.join("\n"));
}

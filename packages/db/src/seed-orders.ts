import { deliveryOptions, platformFeeCents, type ShippingAddress, type ShippingOption } from "@auction/shared";
import type { SeedBid } from "./seed-bids";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PAY_WINDOW_MS = 48 * HOUR;
// The fake carrier moves a parcel to "in transit" a minute after its label and to "delivered" three minutes after it, and a
// payout is due three days after delivery (see FakeShippingProvider and PAYOUT_DELAY_DAYS).
const IN_TRANSIT_AFTER_MS = 60_000;
const DELIVERED_AFTER_MS = 180_000;
const PAYOUT_DELAY_MS = 3 * DAY;

export interface OrderRow {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amountCents: number;
  feeCents: number;
  sellerNetCents: number;
  status: "AWAITING_PAYMENT" | "PAID" | "EXPIRED";
  round: number;
  payBy: Date;
  paidAt: Date | null;
  paymentRef: string | null;
  paymentRefs: string[];
  shippingAddress: ShippingAddress | null;
  shippingOption: ShippingOption | null;
  shippingCents: number | null;
  totalCents: number | null;
  pickupAddress: ShippingAddress | null;
  invoiceNumber: string | null;
  trackingEmails: boolean;
  shipmentStatus: "LABEL_CREATED" | "IN_TRANSIT" | "DELIVERED" | null;
  trackingCode: string | null;
  shippedAt: Date | null;
  inTransitAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}
export interface StrikeRow {
  id: string;
  userId: string;
  listingId: string;
  orderId: string;
  createdAt: Date;
}
export interface RatingRow {
  id: string;
  orderId: string;
  buyerId: string;
  sellerId: string;
  stars: number;
  comment: string | null;
  createdAt: Date;
}
export interface PayoutRow {
  id: string;
  orderId: string;
  sellerId: string;
  amountCents: number;
  reference: string;
  paidAt: Date;
}

export interface SaleInput {
  listingId: string;
  sellerId: string;
  closedAt: Date;
  reservePriceCents: number | null;
  pickupAddress: ShippingAddress | null;
  // The listing's bids, which say who the runner-up is if the winner does not pay.
  bids: readonly SeedBid[];
  winnerId: string;
  finalPriceCents: number;
}

export interface SalePlan {
  orders: OrderRow[];
  strikes: StrikeRow[];
  ratings: RatingRow[];
  payouts: PayoutRow[];
  // How the listing ends up, which differs from the close when buyers did not pay.
  listing: { outcome: "SOLD" | "NO_SALE"; winnerId: string | null; finalPriceCents: number | null };
}

export interface SaleContext {
  random: () => number;
  // Where a buyer can be sent a parcel.
  addresses: readonly ShippingAddress[];
  // Hands out numbers for invoices and tracking codes, so they are unique across the whole seed.
  next: () => number;
}

const COMMENTS: Record<number, string[]> = {
  5: ["Exactly as described and packed with care.", "Fast and friendly, would buy again.", "Perfect. Thank you!", "Great seller, arrived earlier than expected."],
  4: ["Good item, shipping took a little while.", "As described. Happy with it.", "Nice, a small scratch that was not in the photos."],
  3: ["Okay, but a bit worse than the photos looked.", "Item fine, slow reply to my question."],
  2: ["Not quite what I expected from the description."],
  1: ["Arrived damaged and the seller did not answer."],
};

const pickFrom = <T>(items: readonly T[], random: () => number) => items[Math.floor(random() * items.length)];
const weightedStars = (random: () => number) => {
  let roll = random() * 100;
  for (const [stars, weight] of [[5, 50], [4, 25], [3, 10], [2, 8], [1, 7]] as const) if ((roll -= weight) < 0) return stars;
  return 5;
};
const between = (random: () => number, min: number, max: number) => min + random() * (max - min);
const newRow = (listingId: string, round: number) => `${listingId}_o${round}`;

// The person who would be offered an item next if the buyer did not pay: the highest remaining bidder, by their own best bid,
// whose bid meets the reserve (the same rule as OrderExpiryService).
export function runnerUp(bids: readonly SeedBid[], excludedBuyers: readonly string[], reservePriceCents: number | null) {
  const best = new Map<string, number>();
  for (const bid of bids) if (!excludedBuyers.includes(bid.bidderId)) best.set(bid.bidderId, Math.max(best.get(bid.bidderId) ?? 0, bid.amountCents));
  const [next] = [...best.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!next || (reservePriceCents !== null && next[1] < reservePriceCents)) return null;
  return { buyerId: next[0], amountCents: next[1] };
}

interface Step {
  buyerId: string;
  amountCents: number;
  round: number;
  startedAt: Date;
}

// What happened after a sale closed, given how old it is. Within the payment window the buyer is still being waited for; older
// sales mostly were paid, and some were not: the buyer got a strike and the item went to the next bidder, or the sale ended.
// Every row follows the same rules the app applies (fee, delivery price, 48-hour window, strikes, the fake carrier's timings).
export function planSale(sale: SaleInput, now: number, ctx: SaleContext): SalePlan {
  const { random } = ctx;
  const orders: OrderRow[] = [];
  const strikes: StrikeRow[] = [];
  const ratings: RatingRow[] = [];
  const payouts: PayoutRow[] = [];
  const closedAt = sale.closedAt.getTime();
  const recent = now - closedAt < PAY_WINDOW_MS;
  let listing: SalePlan["listing"] = { outcome: "SOLD", winnerId: sale.winnerId, finalPriceCents: sale.finalPriceCents };

  // How many buyers fail to pay before one does (or before the sale ends), for an old sale.
  const failures = recent ? 0 : (() => {
    const roll = random();
    return roll < 0.7 ? 0 : roll < 0.85 ? 1 : roll < 0.95 ? 2 : 3;
  })();

  let step: Step = { buyerId: sale.winnerId, amountCents: sale.finalPriceCents, round: 1, startedAt: sale.closedAt };
  const tried: string[] = [];
  for (let round = 1; ; round++) {
    tried.push(step.buyerId);
    const startedAt = step.startedAt.getTime();
    const payBy = new Date(startedAt + PAY_WINDOW_MS);
    const feeCents = platformFeeCents(step.amountCents, 5, 5000);
    const base = {
      id: newRow(sale.listingId, round),
      listingId: sale.listingId,
      buyerId: step.buyerId,
      sellerId: sale.sellerId,
      amountCents: step.amountCents,
      feeCents,
      sellerNetCents: step.amountCents - feeCents,
      round,
      payBy,
      pickupAddress: sale.pickupAddress,
      createdAt: step.startedAt,
    };
    const empty = { paidAt: null, paymentRef: null, paymentRefs: [] as string[], shippingAddress: null, shippingOption: null, shippingCents: null, totalCents: null, invoiceNumber: null, trackingEmails: false, shipmentStatus: null, trackingCode: null, shippedAt: null, inTransitAt: null, deliveredAt: null };

    // 1. Still inside the window: waiting for the buyer (a few have already chosen delivery, so paying is one click).
    if (recent || round > failures) {
      if (recent && random() < 0.45) {
        const address = pickFrom(ctx.addresses, random);
        const option = pickFrom(deliveryOptions(step.amountCents), random);
        orders.push({ ...base, ...empty, status: "AWAITING_PAYMENT", ...(random() < 0.5 ? { shippingAddress: address, shippingOption: option, shippingCents: option.priceCents, totalCents: step.amountCents + option.priceCents, trackingEmails: random() < 0.5 } : {}) });
        break;
      }
      // 2. Paid, then maybe shipped, delivered, paid out and rated.
      const paidAt = Math.min(now, startedAt + between(random, 0.05 * HOUR, 40 * HOUR));
      if (paidAt > now - 1000) {
        orders.push({ ...base, ...empty, status: "AWAITING_PAYMENT" });
        break;
      }
      const address = pickFrom(ctx.addresses, random);
      const option = pickFrom(deliveryOptions(step.amountCents), random);
      const serial = ctx.next();
      const order: OrderRow = {
        ...base,
        ...empty,
        status: "PAID",
        paidAt: new Date(paidAt),
        paymentRef: `cs_seed_${base.id}`,
        paymentRefs: [`cs_seed_${base.id}`],
        shippingAddress: address,
        shippingOption: option,
        shippingCents: option.priceCents,
        totalCents: step.amountCents + option.priceCents,
        invoiceNumber: `INV-${new Date(paidAt).getUTCFullYear()}-${String(900_000 + serial).padStart(6, "0")}`,
        trackingEmails: random() < 0.4,
      };
      const labelAt = paidAt + between(random, 2 * HOUR, 2 * DAY);
      if (labelAt <= now - 1000 && random() < 0.9) {
        order.shippedAt = new Date(labelAt);
        order.trackingCode = `SEED${String(serial).padStart(7, "0")}`;
        order.shipmentStatus = "LABEL_CREATED";
        if (labelAt + IN_TRANSIT_AFTER_MS <= now) {
          order.shipmentStatus = "IN_TRANSIT";
          order.inTransitAt = new Date(labelAt + IN_TRANSIT_AFTER_MS);
        }
        if (labelAt + DELIVERED_AFTER_MS <= now) {
          order.shipmentStatus = "DELIVERED";
          order.deliveredAt = new Date(labelAt + DELIVERED_AFTER_MS);
        }
      }
      orders.push(order);
      if (order.deliveredAt) {
        const delivered = order.deliveredAt.getTime();
        if (delivered + PAYOUT_DELAY_MS <= now && random() < 0.6) {
          payouts.push({ id: `${base.id}_p`, orderId: base.id, sellerId: sale.sellerId, amountCents: base.sellerNetCents, reference: `tr_seed_${serial}`, paidAt: new Date(delivered + PAYOUT_DELAY_MS + between(random, 0, 6 * HOUR)) });
        }
        if (random() < 0.55) {
          const stars = weightedStars(random);
          ratings.push({ id: `${base.id}_r`, orderId: base.id, buyerId: step.buyerId, sellerId: sale.sellerId, stars, comment: random() < 0.6 ? pickFrom(COMMENTS[stars], random) : null, createdAt: new Date(Math.min(now, delivered + between(random, 0.2 * DAY, 4 * DAY))) });
        }
      }
      break;
    }

    // 3. Not paid in time: the buyer is struck, and the item goes to the next bidder or the sale ends without a sale.
    orders.push({ ...base, ...empty, status: "EXPIRED" });
    strikes.push({ id: `${base.id}_s`, userId: step.buyerId, listingId: sale.listingId, orderId: base.id, createdAt: payBy });
    const next = round < 3 ? runnerUp(sale.bids, tried, sale.reservePriceCents) : null;
    if (!next || payBy.getTime() >= now) {
      listing = { outcome: "NO_SALE", winnerId: null, finalPriceCents: null };
      break;
    }
    listing = { outcome: "SOLD", winnerId: next.buyerId, finalPriceCents: next.amountCents };
    step = { buyerId: next.buyerId, amountCents: next.amountCents, round: round + 1, startedAt: payBy };
  }
  return { orders, strikes, ratings, payouts, listing };
}

export interface MakeOrderInput {
  listingId: string;
  round?: number;
  buyerId: string;
  sellerId: string;
  amountCents: number;
  // When the order was made (the close, or the moment it was offered on); the payment window runs from here.
  startedAt: Date;
  status: OrderRow["status"];
  pickupAddress: ShippingAddress | null;
  // Delivery chosen by the buyer: always set for a paid order, optional for one still waiting.
  delivery?: { address: ShippingAddress; optionId?: string; trackingEmails?: boolean };
  paidAt?: Date;
  // When the seller printed the label; the parcel's state follows from it and the clock, like the fake carrier does.
  labelAt?: Date;
  serial: number;
  now: number;
}

// One order for a hand-made situation, with the same amounts, window and carrier timings as a generated one.
export function makeOrder(input: MakeOrderInput): OrderRow {
  const feeCents = platformFeeCents(input.amountCents, 5, 5000);
  const id = newRow(input.listingId, input.round ?? 1);
  const order: OrderRow = {
    id,
    listingId: input.listingId,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    amountCents: input.amountCents,
    feeCents,
    sellerNetCents: input.amountCents - feeCents,
    status: input.status,
    round: input.round ?? 1,
    payBy: new Date(input.startedAt.getTime() + PAY_WINDOW_MS),
    paidAt: null,
    paymentRef: null,
    paymentRefs: [],
    shippingAddress: null,
    shippingOption: null,
    shippingCents: null,
    totalCents: null,
    pickupAddress: input.pickupAddress,
    invoiceNumber: null,
    trackingEmails: false,
    shipmentStatus: null,
    trackingCode: null,
    shippedAt: null,
    inTransitAt: null,
    deliveredAt: null,
    createdAt: input.startedAt,
  };
  if (input.delivery) {
    const options = deliveryOptions(input.amountCents);
    const option = options.find((o) => o.id === (input.delivery!.optionId ?? "standard")) ?? options[0];
    order.shippingAddress = input.delivery.address;
    order.shippingOption = option;
    order.shippingCents = option.priceCents;
    order.totalCents = input.amountCents + option.priceCents;
    order.trackingEmails = input.delivery.trackingEmails ?? false;
  }
  if (input.status === "PAID") {
    if (!input.paidAt || !order.shippingOption) throw new Error("A paid order needs a payment time and a delivery choice");
    order.paidAt = input.paidAt;
    order.paymentRef = `cs_seed_${id}`;
    order.paymentRefs = [`cs_seed_${id}`];
    order.invoiceNumber = `INV-${input.paidAt.getUTCFullYear()}-${String(900_000 + input.serial).padStart(6, "0")}`;
    if (input.labelAt) {
      const label = input.labelAt.getTime();
      order.shippedAt = input.labelAt;
      order.trackingCode = `SEED${String(input.serial).padStart(7, "0")}`;
      order.shipmentStatus = "LABEL_CREATED";
      if (label + IN_TRANSIT_AFTER_MS <= input.now) {
        order.shipmentStatus = "IN_TRANSIT";
        order.inTransitAt = new Date(label + IN_TRANSIT_AFTER_MS);
      }
      if (label + DELIVERED_AFTER_MS <= input.now) {
        order.shipmentStatus = "DELIVERED";
        order.deliveredAt = new Date(label + DELIVERED_AFTER_MS);
      }
    }
  }
  return order;
}

export const strikeFor = (order: OrderRow): StrikeRow => ({ id: `${order.id}_s`, userId: order.buyerId, listingId: order.listingId, orderId: order.id, createdAt: order.payBy });
export const ratingFor = (order: OrderRow, stars: number, comment: string | null, createdAt: Date): RatingRow => ({ id: `${order.id}_r`, orderId: order.id, buyerId: order.buyerId, sellerId: order.sellerId, stars, comment, createdAt });
export const payoutFor = (order: OrderRow, paidAt: Date, serial: number): PayoutRow => ({ id: `${order.id}_p`, orderId: order.id, sellerId: order.sellerId, amountCents: order.sellerNetCents, reference: `tr_seed_${serial}`, paidAt });

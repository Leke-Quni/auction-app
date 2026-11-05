import { describe, expect, it } from "vitest";
import type { SeedBid } from "./seed-bids";
import { planSale, runnerUp, type SaleContext, type SaleInput } from "./seed-orders";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.parse("2026-11-05T12:00:00Z");
const address = { name: "Arta Krasniqi", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK" as const, phone: "+38344123456" };

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// One counter for the whole run, as in the seed, so invoice numbers and tracking codes are unique across sales.
let serial = 0;
const ctx = (seed: number): SaleContext => ({ random: mulberry(seed), addresses: [address], next: () => ++serial });
const bid = (bidderId: string, amountCents: number): SeedBid => ({ listingId: "L", bidderId, amountCents, idempotencyKey: `${bidderId}-${amountCents}`, createdAt: new Date(now - 5 * DAY) });
const sale = (ageMs: number, over: Partial<SaleInput> = {}): SaleInput => ({
  listingId: "L1", sellerId: "seller", closedAt: new Date(now - ageMs), reservePriceCents: null, pickupAddress: null,
  bids: [bid("a", 1000), bid("b", 1500), bid("c", 2000), bid("a", 2500)], winnerId: "a", finalPriceCents: 2500, ...over,
});
const plans = (ageMs: number, n = 400, over: Partial<SaleInput> = {}) => Array.from({ length: n }, (_, i) => planSale(sale(ageMs, over), now, ctx(i + 1)));

describe("runnerUp", () => {
  it("is the highest remaining bidder by their own best bid, if it meets the reserve", () => {
    const bids = [bid("a", 3000), bid("b", 2000), bid("b", 2400), bid("c", 2200)];
    expect(runnerUp(bids, ["a"], null)).toEqual({ buyerId: "b", amountCents: 2400 });
    expect(runnerUp(bids, ["a", "b"], null)).toEqual({ buyerId: "c", amountCents: 2200 });
    expect(runnerUp(bids, ["a"], 2500)).toBeNull();
    expect(runnerUp(bids, ["a", "b", "c"], null)).toBeNull();
  });
});

describe("planSale", () => {
  it("leaves a sale inside its payment window waiting or paid, never struck", () => {
    for (const plan of plans(10 * HOUR)) {
      expect(plan.strikes).toEqual([]);
      expect(plan.orders).toHaveLength(1);
      expect(["AWAITING_PAYMENT", "PAID"]).toContain(plan.orders[0].status);
      expect(plan.listing).toEqual({ outcome: "SOLD", winnerId: "a", finalPriceCents: 2500 });
    }
  });

  it("gives every order the app's amounts: a 5% fee off the seller, delivery on top for the buyer", () => {
    for (const plan of plans(6 * DAY, 200)) {
      for (const order of plan.orders) {
        expect(order.feeCents).toBe(Math.round(order.amountCents * 0.05));
        expect(order.sellerNetCents).toBe(order.amountCents - order.feeCents);
        expect(order.payBy.getTime() - order.createdAt.getTime()).toBe(48 * HOUR);
        if (order.status === "PAID") expect(order.totalCents).toBe(order.amountCents + order.shippingCents!);
      }
    }
  });

  it("makes paid orders complete: an invoice number, a payment reference, and a parcel that follows the carrier's timings", () => {
    const paid = plans(8 * DAY, 300).flatMap((p) => p.orders).filter((o) => o.status === "PAID");
    expect(paid.length).toBeGreaterThan(100);
    const numbers = new Set<string>();
    for (const o of paid) {
      expect(o.invoiceNumber).toMatch(/^INV-2026-9\d{5}$/);
      expect(o.paymentRef).toBe(`cs_seed_${o.id}`);
      expect(o.paidAt!.getTime()).toBeLessThanOrEqual(o.payBy.getTime());
      expect(o.paidAt!.getTime()).toBeLessThanOrEqual(now);
      if (o.shipmentStatus) {
        expect(o.shippedAt!.getTime()).toBeGreaterThan(o.paidAt!.getTime());
        expect(o.trackingCode).toMatch(/^SEED\d{7}$/);
        if (o.shipmentStatus === "DELIVERED") expect(o.deliveredAt!.getTime() - o.shippedAt!.getTime()).toBe(180_000);
      } else {
        expect([o.shippedAt, o.inTransitAt, o.deliveredAt, o.trackingCode]).toEqual([null, null, null, null]);
      }
      numbers.add(o.invoiceNumber!);
    }
    expect(numbers.size).toBe(paid.length);
  });

  it("strikes a buyer who did not pay, offers the item on, and keeps the listing's result in step with the last order", () => {
    const all = plans(10 * DAY, 600);
    const struck = all.filter((p) => p.strikes.length > 0);
    expect(struck.length).toBeGreaterThan(60);
    for (const plan of struck) {
      expect(plan.strikes.length).toBe(plan.orders.filter((o) => o.status === "EXPIRED").length);
      for (const s of plan.strikes) expect(plan.orders.find((o) => o.id === s.orderId)!.buyerId).toBe(s.userId);
      const last = plan.orders[plan.orders.length - 1];
      if (last.status === "EXPIRED") expect(plan.listing).toEqual({ outcome: "NO_SALE", winnerId: null, finalPriceCents: null });
      else expect(plan.listing).toEqual({ outcome: "SOLD", winnerId: last.buyerId, finalPriceCents: last.amountCents });
      expect(plan.orders.map((o) => o.round)).toEqual(plan.orders.map((_, i) => i + 1));
      expect(new Set(plan.orders.map((o) => o.buyerId)).size).toBe(plan.orders.length);
    }
    expect(all.some((p) => p.listing.outcome === "NO_SALE")).toBe(true);
    expect(all.some((p) => p.orders.length > 1 && p.orders[p.orders.length - 1].status === "PAID")).toBe(true);
  });

  it("never offers an item to a bidder below the reserve, or to more than three buyers", () => {
    for (const plan of plans(10 * DAY, 400, { reservePriceCents: 2300 })) {
      expect(plan.orders.length).toBeLessThanOrEqual(3);
      for (const o of plan.orders) expect(o.amountCents).toBeGreaterThanOrEqual(2300);
    }
  });

  it("rates and pays out only what was delivered, three days apart where it applies", () => {
    const all = plans(12 * DAY, 400);
    for (const plan of all) {
      for (const r of plan.ratings) {
        const order = plan.orders.find((o) => o.id === r.orderId)!;
        expect(order.deliveredAt).not.toBeNull();
        expect(r.stars).toBeGreaterThanOrEqual(1);
        expect(r.stars).toBeLessThanOrEqual(5);
        expect(r.createdAt.getTime()).toBeLessThanOrEqual(now);
      }
      for (const p of plan.payouts) {
        const order = plan.orders.find((o) => o.id === p.orderId)!;
        expect(p.paidAt.getTime()).toBeGreaterThanOrEqual(order.deliveredAt!.getTime() + 3 * DAY);
        expect(p.amountCents).toBe(order.sellerNetCents);
      }
    }
    expect(all.some((p) => p.ratings.length > 0)).toBe(true);
    expect(all.some((p) => p.payouts.length > 0)).toBe(true);
  });
});

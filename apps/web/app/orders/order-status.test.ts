import type { OrderView } from "@auction/shared";
import { describe, expect, it } from "vitest";
import { orderStatusLabel } from "./order-status";

const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: "o1",
  listingId: "L1",
  title: "Lamp",
  status: "PAID",
  amountCents: 1000,
  payBy: "2026-11-06T10:00:00.000Z",
  paidAt: "2026-11-05T10:00:00.000Z",
  viewer: "buyer",
  buyer: { id: "b", username: "ben" },
  seller: { id: "s", username: "sam" },
  shipping: null,
  totalCents: null,
  invoiceNumber: null,
  shipment: null,
  ...over,
});
const shipment = (status: "LABEL_CREATED" | "IN_TRANSIT" | "DELIVERED") => ({ status, trackingCode: "F", shippedAt: "2026-11-05T11:00:00.000Z", inTransitAt: null, deliveredAt: null });

describe("orderStatusLabel", () => {
  it("says an unpaid order is paused, not 'Pay now', while the seller is banned", () => {
    const held = order({ status: "AWAITING_PAYMENT", sellerSuspended: true });
    expect(orderStatusLabel(held)).toEqual({ label: "Paused: the seller's account was suspended", action: false });
    expect(orderStatusLabel({ ...held, sellerSuspended: false }).label).toBe("Pay now");
  });

  it("tells the buyer to pay, and the seller that they are waiting", () => {
    expect(orderStatusLabel(order({ status: "AWAITING_PAYMENT" }))).toEqual({ label: "Pay now", action: true });
    expect(orderStatusLabel(order({ status: "AWAITING_PAYMENT", viewer: "seller" }))).toEqual({ label: "Waiting for the buyer to pay", action: false });
  });

  it("tells the seller to ship a paid order, and the buyer that it is waiting", () => {
    expect(orderStatusLabel(order({ viewer: "seller" }))).toEqual({ label: "Paid: ship it", action: true });
    expect(orderStatusLabel(order())).toEqual({ label: "Paid, waiting for the seller to ship", action: false });
  });

  it("follows the parcel", () => {
    expect(orderStatusLabel(order({ shipment: shipment("LABEL_CREATED") })).label).toBe("Shipped");
    expect(orderStatusLabel(order({ shipment: shipment("IN_TRANSIT") })).label).toBe("In transit");
  });

  it("asks the buyer to rate once delivered, and not again after", () => {
    expect(orderStatusLabel(order({ shipment: shipment("DELIVERED") }))).toEqual({ label: "Delivered: rate the seller", action: true });
    expect(orderStatusLabel(order({ shipment: shipment("DELIVERED"), rating: { stars: 5, comment: null, createdAt: "2026-11-06T10:00:00.000Z" } }))).toEqual({ label: "Delivered", action: false });
  });

  it("tells the seller where the payout stands once delivered", () => {
    const base = { viewer: "seller" as const, shipment: shipment("DELIVERED") };
    const payout = (status: "SCHEDULED" | "WAITING_FOR_ACCOUNT" | "PAID") => ({ status, dueAt: null, paidAt: null, amountCents: 900 });
    expect(orderStatusLabel(order({ ...base, payout: payout("SCHEDULED") })).label).toBe("Delivered, payout scheduled");
    expect(orderStatusLabel(order({ ...base, payout: payout("WAITING_FOR_ACCOUNT") }))).toEqual({ label: "Delivered: set up payouts", action: true });
    expect(orderStatusLabel(order({ ...base, payout: payout("PAID") })).label).toBe("Delivered, paid out");
  });

  it("labels an order that was not paid in time", () => {
    expect(orderStatusLabel(order({ status: "EXPIRED" })).label).toBe("Not paid in time");
  });
});

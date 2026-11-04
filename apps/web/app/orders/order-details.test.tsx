// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { OrderView } from "@auction/shared";
import { afterEach, describe, expect, it } from "vitest";
import { OrderDetails } from "./order-details";

afterEach(cleanup);

const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: "o1",
  listingId: "L1",
  title: "1990s model train",
  status: "AWAITING_PAYMENT",
  amountCents: 3150,
  payBy: "2026-11-06T14:00:00.000Z",
  paidAt: null,
  viewer: "buyer",
  buyer: { id: "b", username: "ben" },
  seller: { id: "s", username: "sam" },
  shipping: null,
  totalCents: null,
  invoiceNumber: null,
  ...over,
});

const shipping = {
  address: { name: "Ben Buyer", line1: "Rr. Nene Tereza 1", city: "Prishtina", postcode: "10000", country: "XK" as const, phone: "+38344111222" },
  optionId: "express",
  name: "Express",
  estimatedDays: 3,
  tracked: true,
  insured: false,
  priceCents: 1190,
};

describe("OrderDetails", () => {
  it("shows the buyer the price, the seller and the deadline, and no fee", () => {
    render(<OrderDetails order={order()} />);
    expect(screen.getByText("€31.50")).toBeTruthy();
    expect(screen.getByText("sam")).toBeTruthy();
    expect(screen.getByText("Waiting for payment")).toBeTruthy();
    expect(screen.getByText("Pay by")).toBeTruthy();
    expect(screen.queryByText("Platform fee")).toBeNull();
    expect(screen.getByRole("link", { name: "1990s model train" }).getAttribute("href")).toBe("/listings/L1");
  });

  it("shows the seller the fee, their share and the buyer", () => {
    render(<OrderDetails order={order({ viewer: "seller", feeCents: 158, sellerNetCents: 2992 })} />);
    expect(screen.getByText("€1.58")).toBeTruthy();
    expect(screen.getByText("€29.92")).toBeTruthy();
    expect(screen.getByText("ben")).toBeTruthy();
  });

  it("shows when it was paid instead of a deadline", () => {
    render(<OrderDetails order={order({ status: "PAID", paidAt: "2026-11-05T10:00:00.000Z" })} />);
    expect(screen.getByText("Paid", { selector: "td" })).toBeTruthy();
    expect(screen.queryByText("Pay by")).toBeNull();
  });

  it("shows the delivery, the address and the total once the buyer has chosen them", () => {
    render(<OrderDetails order={order({ shipping, totalCents: 4340 })} />);
    expect(screen.getByText(/Express, about 3 days, tracked: €11.90/)).toBeTruthy();
    expect(screen.getByText(/Rr. Nene Tereza 1/)).toBeTruthy();
    expect(screen.getByText("€43.40")).toBeTruthy();
    expect(screen.queryByText(/PDF/)).toBeNull();
  });

  it("links the invoice PDF once the order is paid", () => {
    render(<OrderDetails order={order({ status: "PAID", paidAt: "2026-11-05T10:00:00.000Z", shipping, totalCents: 4340, invoiceNumber: "INV-2026-000007" })} />);
    const link = screen.getByRole("link", { name: "INV-2026-000007 (PDF)" });
    expect(link.getAttribute("href")).toBe("/orders/o1/invoice");
  });

  it("shows the seller only the destination town, never 'undefined', with the fee and share; the pickup address has its own card", () => {
    const sellerShipping = { ...shipping, priceCents: undefined, address: { city: "Prishtina", country: "XK" as const } }; // the seller is never sent the delivery price
    render(
      <OrderDetails
        order={order({
          viewer: "seller",
          shipping: sellerShipping,
          totalCents: null,
          feeCents: 158,
          sellerNetCents: 2992,
          pickupAddress: { name: "Sam Seller", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344000111" },
        })}
      />,
    );
    expect(screen.getByText("Destination")).toBeTruthy();
    expect(screen.getByText(/^Prishtina Kosovo$/)).toBeTruthy(); // the town and country, with no postcode in front
    expect(document.body.textContent).not.toContain("undefined");
    expect(screen.queryByText("Collected from")).toBeNull();
    // what the item sold for, the fee, and what they receive: nothing about what the buyer paid in all or for delivery
    expect(screen.getByText("Sold for")).toBeTruthy();
    expect(screen.queryByText("Total")).toBeNull();
    expect(document.body.textContent).not.toMatch(/€43\.40|€11\.90/);
    expect(screen.getByText("Express, about 3 days, tracked")).toBeTruthy();
    expect(screen.queryByText(/Nene Tereza/)).toBeNull();
    expect(screen.getByText("€29.92")).toBeTruthy();
  });
});

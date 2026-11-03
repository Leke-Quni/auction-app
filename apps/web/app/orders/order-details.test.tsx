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
  ...over,
});

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
});

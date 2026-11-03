// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BidHistory, type BidRow } from "./bid-history";

afterEach(cleanup);

const row = (n: number, amountCents: number, bidderId = `u${n}`): BidRow => ({
  id: `b${n}`,
  amountCents,
  createdAt: "2026-11-02T10:00:00Z",
  bidder: { id: bidderId, username: `bidder${n}` },
});

describe("BidHistory", () => {
  it("says there are no bids yet", () => {
    render(<BidHistory bids={[]} total={0} />);
    expect(screen.getByText("No bids yet.")).toBeTruthy();
  });

  it("lists who bid what, in the order given, with the count in the heading", () => {
    render(<BidHistory bids={[row(3, 1300), row(2, 1100), row(1, 1000)]} total={3} />);
    expect(screen.getByRole("heading").textContent).toMatch(/Bid history\s*\(3\)/);
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(cells[0]).toContain("bidder3");
    expect(cells[0]).toContain("€13.00");
    expect(cells[2]).toContain("bidder1");
  });

  it("marks your own bids", () => {
    render(<BidHistory bids={[row(2, 1100, "me"), row(1, 1000)]} total={2} viewerId="me" />);
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.getAllByText("(you)")).toHaveLength(1);
  });

  it("says when only the highest bids are shown", () => {
    render(<BidHistory bids={[row(2, 1100), row(1, 1000)]} total={45} />);
    expect(screen.getByText("Showing the highest 2 of 45 bids.")).toBeTruthy();
  });
});

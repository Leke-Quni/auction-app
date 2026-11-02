// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ListingCard, type ListingSummary } from "./listing-card";

afterEach(cleanup);

const hour = 3_600_000;
const listing = (over: Partial<ListingSummary> = {}): ListingSummary => ({
  id: "L1",
  title: "Vintage wristwatch",
  startingPriceCents: 2_500,
  phase: "live",
  startsAt: new Date(Date.now() - hour).toISOString(),
  endsAt: new Date(Date.now() + hour).toISOString(),
  images: [{ id: "i1", url: "https://example.test/a.jpg" }],
  ...over,
});

describe("ListingCard final-chance tag", () => {
  it("shows on a live auction that has used both extensions", () => {
    render(<ListingCard listing={listing({ finalChance: true })} />);
    expect(screen.getByText("Final chance to bid")).toBeTruthy();
  });

  it("does not show before the second extension, or when the count is missing", () => {
    for (const finalChance of [false, undefined]) {
      render(<ListingCard listing={listing({ finalChance })} />);
      expect(screen.queryByText("Final chance to bid"), String(finalChance)).toBeNull();
      cleanup();
    }
  });

  it("does not show on an auction that is not live", () => {
    for (const phase of ["upcoming", "ended"] as const) {
      render(<ListingCard listing={listing({ phase, finalChance: true })} />);
      expect(screen.queryByText("Final chance to bid"), phase).toBeNull();
      cleanup();
    }
  });

  it("also shows on a listing with no photo", () => {
    render(<ListingCard listing={listing({ images: [], finalChance: true })} />);
    expect(screen.getByText("No photo")).toBeTruthy();
    expect(screen.getByText("Final chance to bid")).toBeTruthy();
  });
});

describe("ListingCard price", () => {
  it("says starting for a listing with no bids", () => {
    render(<ListingCard listing={listing({ currentBidCents: null, bidCount: 0 })} />);
    expect(screen.getByText("€25.00")).toBeTruthy();
    expect(screen.getByText("starting")).toBeTruthy();
    expect(screen.queryByText(/bids?$/)).toBeNull();
  });

  it("shows the current bid and the number of bids once there are some", () => {
    render(<ListingCard listing={listing({ currentBidCents: 4_200, bidCount: 3 })} />);
    expect(screen.getByText(/€42\.00/)).toBeTruthy();
    expect(screen.getByText("current bid")).toBeTruthy();
    expect(screen.getByText(/3 bids/)).toBeTruthy();
    expect(screen.queryByText("starting")).toBeNull();
  });

  it("says '1 bid' for a single bid", () => {
    render(<ListingCard listing={listing({ currentBidCents: 3_000, bidCount: 1 })} />);
    expect(screen.getByText(/1 bid$/)).toBeTruthy();
  });
});

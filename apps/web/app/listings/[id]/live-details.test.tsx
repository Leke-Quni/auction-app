// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./bid-actions", () => ({ placeBidAction: vi.fn() }));

import { LiveAuction, type LiveSnapshot } from "./live-auction";
import { LiveDetails, type DetailsListing } from "./live-details";

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const snapshot: LiveSnapshot = {
  currentBidCents: 2500,
  bidCount: 3,
  highBidder: { id: "ben", username: "ben" },
  minimumNextBidCents: 2625,
  endsAt: "2026-11-01T10:00:00.000Z",
  extensionCount: 0,
  serverTime: "2026-11-02T10:00:00.000Z",
  bids: [],
};

const listing = (over: Partial<DetailsListing> = {}): DetailsListing => ({
  id: "L1",
  phase: "ended",
  condition: "GOOD",
  category: { name: "Art" },
  seller: { username: "sam" },
  startingPriceCents: 1000,
  reservePriceCents: null,
  durationDays: 3,
  startsAt: "2026-10-29T10:00:00.000Z",
  outcome: null,
  winner: null,
  finalPriceCents: null,
  ...over,
});

const show = (l: DetailsListing, viewerId?: string, live: LiveSnapshot = snapshot) =>
  render(
    <LiveAuction listingId="L1" snapshot={live} connect={false}>
      <LiveDetails listing={l} openMode="live" viewerId={viewerId} />
    </LiveAuction>,
  );

describe("the result of an ended auction", () => {
  it("names the winner and the price, and marks the viewer when they won", () => {
    show(listing({ outcome: "SOLD", winner: { id: "ben", username: "ben" }, finalPriceCents: 2500 }));
    expect(screen.getByText("Sold for €25.00 to ben")).toBeTruthy();
    cleanup();
    show(listing({ outcome: "SOLD", winner: { id: "ben", username: "ben" }, finalPriceCents: 2500 }), "ben");
    expect(screen.getByText("Sold for €25.00 to ben (you)")).toBeTruthy();
  });

  it("says why there was no sale", () => {
    show(listing({ outcome: "NO_SALE", reservePriceCents: 5000 })); // the top bid, 25.00, is below the reserve
    expect(screen.getByText("Not sold: the reserve price was not met")).toBeTruthy();
    cleanup();
    show(listing({ outcome: "NO_BIDS" }));
    expect(screen.getByText("Not sold: there were no bids")).toBeTruthy();
  });

  it("blames non-payment, not the reserve, when the buyers the item was offered to did not pay", () => {
    show(listing({ outcome: "NO_SALE", reservePriceCents: null }));
    expect(screen.getByText("Not sold: no buyer paid")).toBeTruthy();
    expect(screen.queryByText(/reserve price was not met/)).toBeNull();
    cleanup();
    show(listing({ outcome: "NO_SALE", reservePriceCents: 2000 })); // the top bid, 25.00, met the reserve
    expect(screen.getByText("Not sold: no buyer paid")).toBeTruthy();
  });

  it("shows no result for an auction that is still live", () => {
    show(listing({ phase: "live" }), undefined, { ...snapshot, endsAt: "2026-11-05T10:00:00.000Z" });
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText("Result")).toBeNull();
  });

  it("asks for the page again every 10 seconds until the result is saved, then stops", () => {
    const { rerender } = show(listing());
    expect(screen.getByText("Closing the auction...")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(2);
    rerender(
      <LiveAuction listingId="L1" snapshot={snapshot} connect={false}>
        <LiveDetails listing={listing({ outcome: "NO_BIDS" })} openMode="live" />
      </LiveAuction>,
    );
    act(() => void vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One router object, as in the app: a new one on every render would restart the effects that depend on it.
const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const { placeBidAction } = vi.hoisted(() => ({ placeBidAction: vi.fn() }));
vi.mock("./bid-actions", () => ({ placeBidAction }));

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
  viewerMaxCents: null,
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

  it("says a moderator ended it, not that nobody paid, when a listing was removed", () => {
    show(listing({ outcome: "NO_SALE", reservePriceCents: 2000, removed: true })); // the top bid met the reserve
    expect(screen.getByText("Ended by a moderator: no sale")).toBeTruthy();
    expect(screen.queryByText(/no buyer paid/)).toBeNull();
    cleanup();
    show(listing({ outcome: "NO_BIDS", removed: true }));
    expect(screen.getByText("Ended by a moderator: no sale")).toBeTruthy();
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

  it("gives up after 30 requests (about five minutes) when the result is never saved", () => {
    show(listing());
    act(() => void vi.advanceTimersByTime(30 * 10_000));
    expect(refresh).toHaveBeenCalledTimes(30);
    act(() => void vi.advanceTimersByTime(10 * 60_000));
    expect(refresh).toHaveBeenCalledTimes(30);
    expect(screen.getByText("Closing the auction...")).toBeTruthy();
  });
});

describe("an upcoming auction reaching its start", () => {
  const upcoming = { ...snapshot, endsAt: "2026-11-05T10:00:00.000Z" };
  const startsIn5s = listing({ phase: "upcoming", startsAt: "2026-11-02T10:00:05.000Z" });

  it("asks for the page once when it goes live, also in Strict Mode, and shows it as live", () => {
    render(
      <StrictMode>
        <LiveAuction listingId="L1" snapshot={upcoming} connect={false}>
          <LiveDetails listing={startsIn5s} openMode="live" />
        </LiveAuction>
      </StrictMode>,
    );
    expect(screen.getByText("Upcoming")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(4_000));
    expect(refresh).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2_000));
    expect(screen.getByText("Live")).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not ask for the page again when a live auction ends", () => {
    show(listing({ phase: "live", outcome: null }), undefined, { ...snapshot, endsAt: "2026-11-02T10:00:05.000Z" });
    expect(screen.getByText("Live")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(6_000));
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the bid panel on the live page", () => {
  const live = listing({ phase: "live", outcome: null });
  const upcomingEnd = { ...snapshot, endsAt: "2026-11-05T10:00:00.000Z" };

  it("shows the person in front their own maximum and a box to raise it", () => {
    render(
      <LiveAuction listingId="L1" snapshot={{ ...upcomingEnd, viewerMaxCents: 5000 }} connect={false}>
        <LiveDetails listing={live} openMode="highest" viewerId="ben" />
      </LiveAuction>,
    );
    expect(screen.getByText("You are the highest bidder.")).toBeTruthy();
    expect(screen.getByText(/Your maximum: €50\.00/)).toBeTruthy();
    expect((screen.getByLabelText("Raise your maximum (€)") as HTMLInputElement).value).toBe("52.50");
  });

  it("follows the minimum next bid of the live store for someone who is not in front", () => {
    render(
      <LiveAuction listingId="L1" snapshot={upcomingEnd} connect={false}>
        <LiveDetails listing={live} openMode="live" viewerId="cara" />
      </LiveAuction>,
    );
    expect((screen.getByLabelText("Your maximum bid (€)") as HTMLInputElement).value).toBe("26.25");
  });

  it("drops the 'highest bidder at €X' line after a bid when the live price moves above X", async () => {
    vi.useRealTimers();
    placeBidAction.mockResolvedValue({ ok: true, outcome: "LEADING", currentBidCents: 1000, yourMaxCents: 5000 });
    const mine = { ...upcomingEnd, currentBidCents: 1000, bidCount: 1, highBidder: { id: "ben", username: "ben" }, viewerMaxCents: 5000 };
    const tree = (snap: LiveSnapshot) => (
      <LiveAuction listingId="L1" snapshot={snap} connect={false}>
        <LiveDetails listing={live} openMode="highest" viewerId="ben" />
      </LiveAuction>
    );
    const { rerender } = render(tree(mine));
    fireEvent.click(screen.getByRole("button", { name: "Raise maximum" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Confirm new maximum of/ }));
    expect(await screen.findByText(/You are the highest bidder at €10\.00/)).toBeTruthy();
    // Someone else bids and Ben is defended: the price is now €21 and his note must not still say €10.
    rerender(tree({ ...mine, currentBidCents: 2100, bidCount: 3, minimumNextBidCents: 2205 }));
    expect(screen.queryByText(/You are the highest bidder at/)).toBeNull();
  });
});

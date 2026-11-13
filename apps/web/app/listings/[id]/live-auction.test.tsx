import type { BidPlacedEvent } from "@auction/shared";
import { describe, expect, it } from "vitest";
import { createLiveStore, missedBids, type LiveSnapshot } from "./live-auction";

const snapshot: LiveSnapshot = {
  currentBidCents: 1000,
  bidCount: 1,
  highBidder: { id: "u1", username: "anna" },
  minimumNextBidCents: 1100,
  endsAt: "2026-11-05T10:00:00.000Z",
  extensionCount: 0,
  serverTime: "2026-11-02T10:00:00.000Z",
  bids: [{ id: "b1", amountCents: 1000, createdAt: "2026-11-02T09:59:00.000Z", bidder: { id: "u1", username: "anna" } }],
};

const event = (over: Partial<BidPlacedEvent> = {}): BidPlacedEvent => ({
  listingId: "l1",
  currentBidCents: 1200,
  bidCount: 2,
  highBidder: { id: "u2", username: "ben" },
  endsAt: "2026-11-05T10:00:00.000Z",
  extensionCount: 0,
  minimumNextBidCents: 1300,
  serverTime: "2026-11-02T10:01:00.000Z",
  extended: false,
  bid: { id: "b2", amountCents: 1200, createdAt: "2026-11-02T10:01:00.000Z", bidder: { id: "u2", username: "ben" } },
  bids: [{ id: "b2", amountCents: 1200, createdAt: "2026-11-02T10:01:00.000Z", bidder: { id: "u2", username: "ben" } }],
  ...over,
});

describe("live auction store", () => {
  it("applies a new bid to the price, bidder, minimum and history", () => {
    const store = createLiveStore(snapshot);
    store.getState().applyBid(event());
    expect(store.getState()).toMatchObject({ currentBidCents: 1200, bidCount: 2, highBidder: { username: "ben" }, minimumNextBidCents: 1300 });
    expect(store.getState().bids.map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  it("ignores a repeated or older bid", () => {
    const store = createLiveStore(snapshot);
    store.getState().applyBid(event());
    store.getState().applyBid(event());
    store.getState().applyBid(event({ bidCount: 1, currentBidCents: 1000 }));
    expect(store.getState().bidCount).toBe(2);
    expect(store.getState().bids).toHaveLength(2);
  });

  it("moves the end time and counts the extension", () => {
    const store = createLiveStore(snapshot);
    store.getState().applyExtended({ listingId: "l1", endsAt: "2026-11-05T10:15:00.000Z", extensionCount: 1, serverTime: "2026-11-05T09:58:00.000Z" });
    expect(store.getState()).toMatchObject({ endsAt: "2026-11-05T10:15:00.000Z", extensionCount: 1 });
  });

  it("does not let an older extension undo a newer one", () => {
    const store = createLiveStore({ ...snapshot, extensionCount: 2 });
    store.getState().applyExtended({ listingId: "l1", endsAt: "2026-11-05T10:15:00.000Z", extensionCount: 1, serverTime: "2026-11-05T09:58:00.000Z" });
    expect(store.getState().extensionCount).toBe(2);
  });

  it("takes a fresh copy from the server only when it is as new as what it holds", () => {
    const store = createLiveStore(snapshot);
    store.getState().applyBid(event());
    store.getState().sync(snapshot);
    expect(store.getState().bidCount).toBe(2);
    store.getState().sync({ ...snapshot, bidCount: 3, currentBidCents: 1500 });
    expect(store.getState()).toMatchObject({ bidCount: 3, currentBidCents: 1500 });
  });

  it("keeps only the newest 5 rows", () => {
    const store = createLiveStore({ ...snapshot, bidCount: 0, bids: [] });
    for (let i = 1; i <= 25; i++) {
      const row = { id: `b${i}`, amountCents: 1000 + i, createdAt: "2026-11-02T10:01:00.000Z", bidder: { id: "u2", username: "ben" } };
      store.getState().applyBid(event({ bidCount: i, bid: row, bids: [row] }));
    }
    expect(store.getState().bids).toHaveLength(5);
    expect(store.getState().bids[0].id).toBe("b25");
  });

  it("adds every row of a defended bid, newest first", () => {
    const store = createLiveStore(snapshot);
    const ben = { id: "u2", username: "ben" };
    const anna = { id: "u1", username: "anna" };
    store.getState().applyBid(
      event({
        bidCount: 3,
        currentBidCents: 1200,
        highBidder: anna,
        bid: { id: "b3", amountCents: 1200, createdAt: "2026-11-02T10:01:00.000Z", bidder: anna },
        bids: [
          { id: "b2", amountCents: 1100, createdAt: "2026-11-02T10:01:00.000Z", bidder: ben },
          { id: "b3", amountCents: 1200, createdAt: "2026-11-02T10:01:00.000Z", bidder: anna },
        ],
      }),
    );
    expect(store.getState().bids.map((b) => b.id)).toEqual(["b3", "b2", "b1"]);
    expect(store.getState().bidCount).toBe(3);
  });

  it("still works with an older server that sends only the top row", () => {
    const store = createLiveStore(snapshot);
    const old = { ...event(), bids: undefined } as unknown as BidPlacedEvent;
    store.getState().applyBid(old);
    expect(store.getState().bids.map((b) => b.id)).toEqual(["b2", "b1"]);
  });
});

describe("missedBids", () => {
  it("is false for the next bid, however many rows it made", () => {
    expect(missedBids(1, event())).toBe(false);
    expect(missedBids(1, event({ bidCount: 3, bids: [event().bid, event().bid] }))).toBe(false);
  });

  it("is true when rows are missing between what is held and the event", () => {
    expect(missedBids(1, event({ bidCount: 4, bids: [event().bid, event().bid] }))).toBe(true);
  });

  it("is false for a repeated event", () => {
    expect(missedBids(2, event())).toBe(false);
  });

  it("treats an event without rows as one row", () => {
    const old = { ...event({ bidCount: 3 }), bids: undefined } as unknown as BidPlacedEvent;
    expect(missedBids(1, old)).toBe(true);
  });
});

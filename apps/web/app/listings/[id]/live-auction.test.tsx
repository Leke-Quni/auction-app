import type { BidPlacedEvent } from "@auction/shared";
import { describe, expect, it } from "vitest";
import { createLiveStore, type LiveSnapshot } from "./live-auction";

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

  it("keeps only the newest 20 rows", () => {
    const store = createLiveStore({ ...snapshot, bidCount: 0, bids: [] });
    for (let i = 1; i <= 25; i++) {
      store.getState().applyBid(event({ bidCount: i, bid: { id: `b${i}`, amountCents: 1000 + i, createdAt: "2026-11-02T10:01:00.000Z", bidder: { id: "u2", username: "ben" } } }));
    }
    expect(store.getState().bids).toHaveLength(20);
    expect(store.getState().bids[0].id).toBe("b25");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuctionEvents } from "../src/bids/auction-events";
import type { BidResult } from "../src/bids/bids.service";
import { SearchSyncService } from "../src/search/search-sync.service";
import type { LiveFields, SearchIndex } from "../src/search/search-index";

const endsAt = new Date("2026-11-05T10:00:00Z");
const result = (over: Partial<BidResult["listing"]> = {}, extended = false, replayed = false): BidResult => ({
  bid: { id: "b", amountCents: 1000, createdAt: new Date(), bidder: { id: "u1", username: "anna" } },
  rows: [{ id: "b", amountCents: 1000, createdAt: new Date(), bidder: { id: "u1", username: "anna" } }],
  outcome: "LEADING",
  yourMaxCents: 1000,
  requestedBy: "u1",
  listing: {
    id: "L1",
    currentBidCents: 1000,
    bidCount: 1,
    endsAt,
    extensionCount: 0,
    finalChance: false,
    minimumNextBidCents: 1100,
    highBidderId: "u1",
    highBidder: { id: "u1", username: "anna" },
    ...over,
  },
  extended,
  replayed,
  previousHighBidderId: null,
});

describe("SearchSyncService", () => {
  let events: AuctionEvents;
  let calls: { id: string; fields: LiveFields }[];
  let fail: boolean;
  let service: SearchSyncService;

  const bid = (r: BidResult, listingId = "L1") => events.publish({ type: "BidPlaced", listingId, result: r });

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.SEARCH_PRICE_THROTTLE_SECONDS = "5";
    events = new AuctionEvents();
    calls = [];
    fail = false;
    const search = {
      async update(id: string, fields: LiveFields) {
        if (fail) throw new Error("search is down");
        calls.push({ id, fields });
      },
    } as unknown as SearchIndex;
    service = new SearchSyncService(events, search);
    service.onModuleInit();
  });
  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
    delete process.env.SEARCH_PRICE_THROTTLE_SECONDS;
  });

  it("sends the price, bid count, final-chance flag and end time (in seconds) of the first bid at once", () => {
    bid(result({ currentBidCents: 1500, bidCount: 3 }));
    expect(calls).toEqual([{ id: "L1", fields: { price_cents: 1500, bid_count: 3, final_chance: false, ends_at: endsAt.getTime() / 1000 } }]);
  });

  it("holds back bids inside the window and sends only the newest when it ends", async () => {
    bid(result({ currentBidCents: 1000, bidCount: 1 }));
    vi.advanceTimersByTime(1000);
    bid(result({ currentBidCents: 1100, bidCount: 2 }));
    vi.advanceTimersByTime(1000);
    bid(result({ currentBidCents: 1300, bidCount: 3 }));
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3100);
    expect(calls.map((c) => [c.fields.price_cents, c.fields.bid_count])).toEqual([[1000, 1], [1300, 3]]);
  });

  it("sends an extension at once, even inside the window, so the end time is never stale", async () => {
    bid(result({ currentBidCents: 1000, bidCount: 1 }));
    const later = new Date(endsAt.getTime() + 120_000);
    bid(result({ currentBidCents: 1100, bidCount: 2, endsAt: later, finalChance: true }, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].fields).toEqual({ price_cents: 1100, bid_count: 2, final_chance: true, ends_at: later.getTime() / 1000 });
  });

  it("does not send an older held-back bid after an extension carried the newer one", async () => {
    bid(result({ currentBidCents: 1000, bidCount: 1 }));
    bid(result({ currentBidCents: 1100, bidCount: 2 }));
    bid(result({ currentBidCents: 1200, bidCount: 3 }, true));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.map((c) => c.fields.bid_count)).toEqual([1, 3]);
  });

  it("keeps each auction on its own window", () => {
    bid(result(), "L1");
    bid(result(), "L2");
    expect(calls.map((c) => c.id)).toEqual(["L1", "L2"]);
  });

  it("sends the next bid at once after a quiet window, and ignores a replay", async () => {
    bid(result({ bidCount: 1 }));
    await vi.advanceTimersByTimeAsync(6000);
    bid(result({ bidCount: 2 }));
    bid(result({ bidCount: 3 }, false, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.fields.bid_count)).toEqual([1, 2]);
  });

  it("logs a failed update and carries on with the next", async () => {
    fail = true;
    bid(result({ bidCount: 1 }));
    await vi.advanceTimersByTimeAsync(6000);
    fail = false;
    bid(result({ bidCount: 2 }));
    expect(calls.map((c) => c.fields.bid_count)).toEqual([2]);
  });

  it("sends updates for one auction in order even when an earlier one is slow", async () => {
    const order: number[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const search = {
      async update(_id: string, fields: LiveFields) {
        if (first) {
          first = false;
          await slow;
        }
        order.push(fields.bid_count as number);
      },
    } as unknown as SearchIndex;
    service.onModuleDestroy();
    service = new SearchSyncService(events, search);
    service.onModuleInit();
    bid(result({ bidCount: 1 }));
    bid(result({ bidCount: 2 }, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1, 2]);
  });
});

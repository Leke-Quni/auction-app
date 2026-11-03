import { minimumNextBidCents } from "@auction/shared";
import { describe, expect, it } from "vitest";
import { generateBids } from "./seed-bids";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const now = Date.parse("2026-11-02T12:00:00Z");
const bidders = Array.from({ length: 6 }, (_, i) => `u${i}`);
const live = { id: "L1", sellerId: "u0", startingPriceCents: 1500, startsAt: new Date(now - 2 * DAY), endsAt: new Date(now + DAY) };

const many = (listing = live, runs = 300) => Array.from({ length: runs }, (_, i) => generateBids(listing, bidders, now, mulberry32(i + 1)));

describe("generateBids", () => {
  it("obeys the bid rules in every run: first at the starting price, then the minimum, never by the seller or twice in a row", () => {
    for (const { bids } of many()) {
      let current: number | null = null;
      let last: string | null = null;
      for (const bid of bids) {
        expect(bid.amountCents).toBeGreaterThanOrEqual(minimumNextBidCents({ startingPriceCents: live.startingPriceCents, currentBidCents: current }));
        expect(bid.bidderId).not.toBe(live.sellerId);
        expect(bid.bidderId).not.toBe(last);
        current = bid.amountCents;
        last = bid.bidderId;
      }
    }
  });

  it("puts the bids between the start and now, in strictly increasing time order, with unique keys", () => {
    for (const { bids } of many()) {
      const times = bids.map((b) => b.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(new Set(times).size).toBe(times.length);
      for (const t of times) {
        expect(t).toBeGreaterThanOrEqual(live.startsAt.getTime());
        expect(t).toBeLessThanOrEqual(now + bids.length);
      }
      expect(new Set(bids.map((b) => b.idempotencyKey)).size).toBe(bids.length);
    }
  });

  it("keeps the listing fields in agreement with the bids, as the database requires", () => {
    for (const result of many()) {
      if (result.bids.length === 0) {
        expect(result).toMatchObject({ currentBidCents: null, bidCount: 0, highBidderId: null });
      } else {
        const top = result.bids[result.bids.length - 1];
        expect(result).toMatchObject({ currentBidCents: top.amountCents, bidCount: result.bids.length, highBidderId: top.bidderId });
        expect(result.currentBidCents).toBe(Math.max(...result.bids.map((b) => b.amountCents)));
      }
    }
  });

  it("gives some auctions no bids, most a few, and a few a bidding war", () => {
    const counts = many(live, 600).map((r) => r.bidCount);
    expect(counts.filter((c) => c === 0).length).toBeGreaterThan(100);
    expect(counts.filter((c) => c >= 1 && c <= 5).length).toBeGreaterThan(200);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(14);
  });

  it("gives upcoming auctions no bids and ended auctions bids only before they ended", () => {
    const upcoming = { ...live, startsAt: new Date(now + DAY), endsAt: new Date(now + 4 * DAY) };
    expect(many(upcoming).every((r) => r.bidCount === 0)).toBe(true);
    const ended = { ...live, startsAt: new Date(now - 5 * DAY), endsAt: new Date(now - 2 * DAY) };
    const withBids = many(ended).flatMap((r) => r.bids);
    expect(withBids.length).toBeGreaterThan(0);
    for (const bid of withBids) expect(bid.createdAt.getTime()).toBeLessThanOrEqual(ended.endsAt.getTime() + 30);
  });

  it("is repeatable for the same random stream", () => {
    expect(generateBids(live, bidders, now, mulberry32(7))).toEqual(generateBids(live, bidders, now, mulberry32(7)));
  });
});

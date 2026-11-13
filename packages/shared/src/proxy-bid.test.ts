import { describe, expect, it } from "vitest";
import { MAX_BID_CENTS, minimumNextBidCents } from "./bids";
import { resolveProxyBid, type ProxyBidInput, type ProxyResult, type ProxyRow } from "./proxy-bid";

const ok = (r: ProxyResult) => {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
};
const input = (over: Partial<ProxyBidInput> & { bidderId: string; maxCents: number }): ProxyBidInput => ({
  startingPriceCents: 1000,
  reservePriceCents: null,
  currentBidCents: null,
  leader: null,
  ...over,
});
const rows = (r: ProxyResult) => ok(r).rows.map((x: ProxyRow) => `${x.bidderId}:${x.kind}:${x.amountCents}`);

describe("resolveProxyBid: the worked examples (starting price €10)", () => {
  it("1. the first bid sets the starting price, whatever the maximum", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "A", maxCents: 5000 })));
    expect(rows(r)).toEqual(["A:BID:1000"]);
    expect(r).toMatchObject({ outcome: "LEADING", priceCents: 1000, leaderId: "A", leaderMaxCents: 5000, leaderChanged: true, priceChanged: true });
  });

  it("2. a challenger below the leader's maximum is beaten at once, one step above their own", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 2000, currentBidCents: 1000, leader: { bidderId: "A", maxCents: 5000 } })));
    expect(rows(r)).toEqual(["B:BID:2000", "A:AUTO:2100"]);
    expect(r).toMatchObject({ outcome: "OUTBID_BY_PROXY", priceCents: 2100, leaderId: "A", leaderMaxCents: 5000, leaderChanged: false, priceChanged: true });
  });

  it("3. a challenger above the leader's maximum takes the lead one step above it", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 6000, currentBidCents: 2100, leader: { bidderId: "A", maxCents: 5000 } })));
    expect(rows(r)).toEqual(["A:AUTO:5000", "B:BID:5250"]);
    expect(r).toMatchObject({ outcome: "LEADING", priceCents: 5250, leaderId: "B", leaderMaxCents: 6000, leaderChanged: true });
  });

  it("4. a tie goes to the earlier maximum, at that amount", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "A", maxCents: 6000, currentBidCents: 5250, leader: { bidderId: "B", maxCents: 6000 } })));
    expect(rows(r)).toEqual(["A:BID:6000", "B:AUTO:6000"]);
    expect(r).toMatchObject({ outcome: "OUTBID_BY_PROXY", priceCents: 6000, leaderId: "B", leaderChanged: false });
  });

  it("5. the leader raising their own maximum changes nothing visible", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 8000, currentBidCents: 6000, leader: { bidderId: "B", maxCents: 6000 } })));
    expect(rows(r)).toEqual(["B:RAISE:6000"]);
    expect(r).toMatchObject({ outcome: "MAX_RAISED", priceCents: 6000, leaderId: "B", leaderMaxCents: 8000, leaderChanged: false, priceChanged: false });
  });

  it("6. a lone bidder whose maximum covers the reserve takes the price up to it", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "A", maxCents: 15_000, reservePriceCents: 10_000 })));
    expect(rows(r)).toEqual(["A:BID:10000"]);
    expect(r.priceCents).toBe(10_000);
  });
});

describe("resolveProxyBid: refusals", () => {
  it("refuses a first bid below the starting price and says what is needed", () => {
    expect(resolveProxyBid(input({ bidderId: "A", maxCents: 999 }))).toEqual({ ok: false, reason: "TOO_LOW", minimumNextBidCents: 1000 });
  });

  it("refuses a challenger below the minimum next bid, as before", () => {
    const leader = { bidderId: "A", maxCents: 5000 };
    expect(resolveProxyBid(input({ bidderId: "B", maxCents: 2099, currentBidCents: 2000, leader }))).toEqual({ ok: false, reason: "TOO_LOW", minimumNextBidCents: 2100 });
    expect(resolveProxyBid(input({ bidderId: "B", maxCents: 2100, currentBidCents: 2000, leader })).ok).toBe(true);
  });

  it("refuses a leader whose new maximum is not higher", () => {
    const leader = { bidderId: "A", maxCents: 5000 };
    expect(resolveProxyBid(input({ bidderId: "A", maxCents: 5000, currentBidCents: 2000, leader }))).toEqual({ ok: false, reason: "MAX_NOT_HIGHER" });
    expect(resolveProxyBid(input({ bidderId: "A", maxCents: 4000, currentBidCents: 2000, leader }))).toEqual({ ok: false, reason: "MAX_NOT_HIGHER" });
    expect(resolveProxyBid(input({ bidderId: "A", maxCents: 5001, currentBidCents: 2000, leader })).ok).toBe(true);
  });
});

describe("resolveProxyBid: the steps", () => {
  it("takes the lead at the challenger's maximum when that is less than a full step above the old maximum", () => {
    // The old maximum is €50, one step is €2.50, so €51 is below €52.50.
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 5100, currentBidCents: 2000, leader: { bidderId: "A", maxCents: 5000 } })));
    expect(rows(r)).toEqual(["A:AUTO:5000", "B:BID:5100"]);
    expect(r.priceCents).toBe(5100);
  });

  it("adds no counter row for a leader whose maximum is only their price (an old bid, or a leader who may not defend)", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 3000, currentBidCents: 2000, leader: { bidderId: "A", maxCents: 2000 } })));
    expect(rows(r)).toEqual(["B:BID:2100"]);
    expect(r).toMatchObject({ priceCents: 2100, leaderId: "B", leaderChanged: true });
  });

  it("caps the defence at the leader's maximum when one step above the challenger would pass it", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 4800, currentBidCents: 2000, leader: { bidderId: "A", maxCents: 5000 } })));
    expect(rows(r)).toEqual(["B:BID:4800", "A:AUTO:5000"]);
    expect(r.priceCents).toBe(5000);
  });

  it("uses the €1 floor under €20 and 5% from there, rounded up to the cent", () => {
    const defend = (challengerMax: number) => ok(resolveProxyBid(input({ startingPriceCents: 50, bidderId: "B", maxCents: challengerMax, currentBidCents: 50, leader: { bidderId: "A", maxCents: 100_000 } }))).priceCents;
    expect(defend(150)).toBe(250);
    expect(defend(1999)).toBe(2099);
    expect(defend(2000)).toBe(2100);
    expect(defend(2001)).toBe(2102);
  });

  it("never passes the €10,000,000 cap", () => {
    // One step above €9.5M is €9.975M, below the cap; a leader at the cap cannot be outbid at all.
    const takeover = ok(resolveProxyBid(input({ bidderId: "B", maxCents: MAX_BID_CENTS, currentBidCents: 900_000_000, leader: { bidderId: "A", maxCents: 950_000_000 } })));
    expect(takeover.priceCents).toBe(997_500_000);
    const defended = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 990_000_000, currentBidCents: 900_000_000, leader: { bidderId: "A", maxCents: MAX_BID_CENTS } })));
    expect(defended.priceCents).toBe(MAX_BID_CENTS);
    expect(resolveProxyBid(input({ bidderId: "C", maxCents: MAX_BID_CENTS, currentBidCents: MAX_BID_CENTS, leader: { bidderId: "A", maxCents: MAX_BID_CENTS } })).ok).toBe(false);
  });
});

describe("resolveProxyBid: the reserve", () => {
  const leader = { bidderId: "A", maxCents: 20_000 };
  it("does nothing without a reserve, or when the maximum does not cover it", () => {
    expect(ok(resolveProxyBid(input({ bidderId: "A", maxCents: 9000, reservePriceCents: 10_000 }))).priceCents).toBe(1000);
    expect(ok(resolveProxyBid(input({ bidderId: "A", maxCents: 9000 }))).priceCents).toBe(1000);
  });

  it("covers it exactly: the price becomes the reserve", () => {
    expect(ok(resolveProxyBid(input({ bidderId: "A", maxCents: 10_000, reservePriceCents: 10_000 }))).priceCents).toBe(10_000);
  });

  it("raises the leader's own row after a takeover", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 30_000, reservePriceCents: 25_000, currentBidCents: 1500, leader })));
    expect(rows(r)).toEqual(["A:AUTO:20000", "B:BID:25000"]);
    expect(r.priceCents).toBe(25_000);
  });

  it("raises the defender's row when the leader's maximum covers the reserve", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 1500, reservePriceCents: 10_000, currentBidCents: 1000, leader })));
    expect(rows(r)).toEqual(["B:BID:1500", "A:AUTO:10000"]);
    expect(r).toMatchObject({ priceCents: 10_000, leaderId: "A" });
  });

  it("adds a visible row after a hidden raise that lifts the price to the reserve", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "A", maxCents: 30_000, reservePriceCents: 25_000, currentBidCents: 1500, leader: { bidderId: "A", maxCents: 2000 } })));
    expect(rows(r)).toEqual(["A:RAISE:1500", "A:AUTO:25000"]);
    expect(r).toMatchObject({ outcome: "MAX_RAISED", priceCents: 25_000, priceChanged: true, leaderChanged: false });
  });

  it("leaves a price already at or above the reserve alone", () => {
    const r = ok(resolveProxyBid(input({ bidderId: "B", maxCents: 15_000, reservePriceCents: 5000, currentBidCents: 6000, leader })));
    expect(r.priceCents).toBe(minimumNextBidCents({ startingPriceCents: 0, currentBidCents: 15_000 }) > 20_000 ? 20_000 : 15_000 + 750);
  });
});

// A small seeded generator, so a failing sequence can be replayed.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("resolveProxyBid: invariants over random auctions", () => {
  it.each([1, 2, 3, 4, 5])("holds for 200 random bids (seed %i)", (seed) => {
    const random = mulberry32(seed);
    const pick = (n: number) => Math.floor(random() * n);
    const startingPriceCents = [50, 1000, 2500, 100_000][pick(4)]!;
    const reservePriceCents = random() < 0.4 ? startingPriceCents * (1 + pick(30)) : null;
    const bidders = ["A", "B", "C", "D"];
    const maxes = new Map<string, number>();
    let price: number | null = null;
    let leaderId: string | null = null;

    for (let step = 0; step < 200; step++) {
      const bidderId = bidders[pick(bidders.length)]!;
      const minimum = minimumNextBidCents({ startingPriceCents, currentBidCents: price });
      const leaderMax = leaderId ? maxes.get(leaderId)! : 0;
      // Mostly sensible amounts, sometimes below the minimum, equal to the leader's maximum, or huge.
      const roll = random();
      const maxCents = Math.min(
        MAX_BID_CENTS,
        roll < 0.1 ? Math.max(1, minimum - 1 - pick(50))
          : roll < 0.25 && leaderId ? leaderMax
          : roll < 0.3 ? MAX_BID_CENTS - pick(1000)
          : minimum + pick(Math.max(1, Math.round(minimum * (random() < 0.5 ? 0.3 : 3)))),
      );
      const result = resolveProxyBid({
        startingPriceCents, reservePriceCents, currentBidCents: price, bidderId, maxCents,
        leader: leaderId ? { bidderId: leaderId, maxCents: maxes.get(leaderId)! } : null,
      });
      if (!result.ok) continue; // a refusal changes nothing

      const before = price;
      maxes.set(bidderId, Math.max(maxes.get(bidderId) ?? 0, maxCents));
      price = result.priceCents;
      leaderId = result.leaderId;

      expect(result.leaderMaxCents).toBe(maxes.get(leaderId)!);
      // The price never passes the leader's maximum, never drops, and never starts below the starting price.
      expect(price).toBeLessThanOrEqual(result.leaderMaxCents);
      expect(price).toBeGreaterThanOrEqual(before ?? startingPriceCents);
      expect(price).toBeGreaterThanOrEqual(startingPriceCents);
      expect(price).toBeLessThanOrEqual(MAX_BID_CENTS);
      // The leader holds the highest maximum.
      for (const m of maxes.values()) expect(result.leaderMaxCents).toBeGreaterThanOrEqual(m);
      // Rows never go down, start at or above the old price, and the last visible one is the price.
      const visible = result.rows.filter((r) => r.kind !== "RAISE");
      let previous = before ?? 0;
      for (const r of result.rows) {
        expect(r.amountCents).toBeGreaterThanOrEqual(previous);
        previous = r.amountCents;
      }
      expect(result.priceChanged).toBe(visible.length > 0);
      if (visible.length > 0) expect(visible[visible.length - 1]!.amountCents).toBe(price);
      // A reserve covered by the leader's maximum is always met.
      if (reservePriceCents !== null && result.leaderMaxCents >= reservePriceCents) expect(price).toBeGreaterThanOrEqual(reservePriceCents);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  ANTI_SNIPING,
  MAX_BID_CENTS,
  endsAtAfterBid,
  extensionCeiling,
  isFinalChance,
  minimumNextBidCents,
  placeBidSchema,
} from "./bids";

const listing = (currentBidCents: number | null, startingPriceCents = 500) => ({ startingPriceCents, currentBidCents });

describe("minimumNextBidCents", () => {
  it("needs only the starting price for the first bid", () => {
    expect(minimumNextBidCents(listing(null, 500))).toBe(500);
    expect(minimumNextBidCents(listing(null, 12_345))).toBe(12_345);
  });

  it("follows the examples in the design: €10 -> €11, €100 -> €105, €1,000 -> €1,050", () => {
    expect(minimumNextBidCents(listing(1_000))).toBe(1_100);
    expect(minimumNextBidCents(listing(10_000))).toBe(10_500);
    expect(minimumNextBidCents(listing(100_000))).toBe(105_000);
  });

  it("rises by at least €1 while 5% is smaller, and switches at €20", () => {
    expect(minimumNextBidCents(listing(100))).toBe(200);
    expect(minimumNextBidCents(listing(1_999))).toBe(2_099);
    expect(minimumNextBidCents(listing(2_000))).toBe(2_100);
    expect(minimumNextBidCents(listing(2_020))).toBe(2_121);
  });

  it("rounds a fractional cent up, so the rise is never below 5%", () => {
    expect(minimumNextBidCents(listing(10_101))).toBe(10_101 + 506);
    expect(minimumNextBidCents(listing(2_001))).toBe(2_001 + 101);
  });

  it("takes the percentage as a setting", () => {
    expect(minimumNextBidCents(listing(10_000), 10)).toBe(11_000);
    expect(minimumNextBidCents(listing(10_000), 1)).toBe(10_100);
  });

  it("stays a whole number of cents", () => {
    for (const current of [101, 1_234, 99_999, 123_457, 7_777_777]) {
      expect(Number.isInteger(minimumNextBidCents(listing(current)))).toBe(true);
    }
  });
});

describe("endsAtAfterBid", () => {
  const end = new Date("2026-11-02T12:00:00Z");
  const far = new Date("2026-11-03T12:00:00Z");
  const at = (time: string) => new Date(`2026-11-02T${time}Z`);
  const result = (endsAt: Date, bidAt: string, ceiling = far) => endsAtAfterBid(endsAt, at(bidAt), ceiling);

  it("leaves the end alone for a bid earlier than the last 2 minutes", () => {
    expect(result(end, "11:00:00")).toEqual({ endsAt: end, extended: false });
    expect(result(end, "11:57:59")).toEqual({ endsAt: end, extended: false });
  });

  it("moves the end to 2 minutes after a bid in the last 2 minutes", () => {
    expect(result(end, "11:58:00")).toEqual({ endsAt: at("12:00:00"), extended: false }); // 2 minutes after is the same end
    expect(result(end, "11:58:01")).toEqual({ endsAt: at("12:00:01"), extended: true });
    expect(result(end, "11:59:00")).toEqual({ endsAt: at("12:01:00"), extended: true });
    expect(result(end, "11:59:59")).toEqual({ endsAt: at("12:01:59"), extended: true });
  });

  it("keeps extending for as long as late bids keep coming", () => {
    let ends = end;
    for (const time of ["11:59:00", "12:00:30", "12:02:00", "12:03:30"]) {
      const out = result(ends, time);
      expect(out.extended, time).toBe(true);
      ends = out.endsAt;
    }
    expect(ends).toEqual(at("12:05:30"));
  });

  it("never moves the end earlier, and ignores a bid at or after the end", () => {
    for (const time of ["10:00:00", "11:58:00", "11:59:00", "11:59:59"]) {
      expect(result(end, time).endsAt.getTime(), time).toBeGreaterThanOrEqual(end.getTime());
    }
    expect(result(end, "12:00:00")).toEqual({ endsAt: end, extended: false });
    expect(result(end, "12:05:00")).toEqual({ endsAt: end, extended: false });
  });

  describe("the ceiling", () => {
    const ceiling = at("12:10:00");

    it("stops the end at the ceiling, however many bids come", () => {
      const out = result(at("12:09:00"), "12:08:30", ceiling);
      expect(out).toEqual({ endsAt: ceiling, extended: true });
    });

    it("does not move the end once it is at the ceiling", () => {
      expect(result(ceiling, "12:09:59", ceiling)).toEqual({ endsAt: ceiling, extended: false });
      expect(result(ceiling, "12:09:00", ceiling)).toEqual({ endsAt: ceiling, extended: false });
    });

    it("never pulls an end back to the ceiling if it was somehow already past it", () => {
      expect(result(at("12:20:00"), "12:19:00", ceiling).endsAt).toEqual(at("12:20:00"));
    });
  });

  it("is a 2-minute window, a 2-minute extension and 24 hours of extra time at most", () => {
    expect(ANTI_SNIPING).toEqual({ windowMs: 120_000, extensionMs: 120_000, maxExtraMs: 86_400_000 });
  });
});

describe("extensionCeiling", () => {
  it("is the original end (start plus duration) plus 24 hours", () => {
    const starts = new Date("2026-11-02T10:00:00Z");
    expect(extensionCeiling(starts, 3)).toEqual(new Date("2026-11-06T10:00:00Z"));
    expect(extensionCeiling(starts, 1)).toEqual(new Date("2026-11-04T10:00:00Z"));
  });
});

describe("isFinalChance", () => {
  const ceiling = new Date("2026-11-06T10:00:00Z");

  it("is true only once the end time has reached the ceiling", () => {
    expect(isFinalChance(new Date("2026-11-05T10:00:00Z"), ceiling)).toBe(false);
    expect(isFinalChance(new Date("2026-11-06T09:59:59Z"), ceiling)).toBe(false);
    expect(isFinalChance(ceiling, ceiling)).toBe(true);
  });
});

describe("minimumNextBidCents over the whole range", () => {
  it("always rises by at least €1 and at least 5%, by no more than a cent over that, and fits a 32-bit column", () => {
    // Plain comparisons, with one assertion at the end: an `expect` per value made this too slow on a busy CI runner.
    const wrong: number[] = [];
    for (let current = 1; current <= 400_000; current += 7) {
      const rise = minimumNextBidCents({ startingPriceCents: 100, currentBidCents: current }) - current;
      if (rise < 100 || rise < current * 0.05 || rise >= Math.max(100, current * 0.05) + 1) wrong.push(current);
    }
    expect(wrong).toEqual([]);
    expect(minimumNextBidCents({ startingPriceCents: 100, currentBidCents: MAX_BID_CENTS })).toBeLessThan(2_147_483_647);
  });
});

describe("placeBidSchema", () => {
  const key = "a1b2c3d4-e5f6";

  it("allows the largest bid, and no more", () => {
    expect(placeBidSchema.safeParse({ amountCents: MAX_BID_CENTS, idempotencyKey: key }).success).toBe(true);
    expect(placeBidSchema.safeParse({ amountCents: MAX_BID_CENTS + 1, idempotencyKey: key }).success).toBe(false);
  });

  it("accepts a whole number of cents with a key", () => {
    expect(placeBidSchema.parse({ amountCents: 10_500, idempotencyKey: key })).toEqual({ amountCents: 10_500, idempotencyKey: key });
  });

  it("rejects an amount that is not a positive whole number of cents or is too high", () => {
    for (const amountCents of [0, -1, 10.5, MAX_BID_CENTS + 1, "100", null]) {
      expect(placeBidSchema.safeParse({ amountCents, idempotencyKey: key }).success, String(amountCents)).toBe(false);
    }
  });

  it("rejects a missing, short, long or odd key", () => {
    for (const idempotencyKey of [undefined, "", "short", "x".repeat(65), "has spaces here", "semi;colon;key"]) {
      expect(placeBidSchema.safeParse({ amountCents: 1_000, idempotencyKey }).success, String(idempotencyKey)).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  ANTI_SNIPING_STEPS,
  MAX_BID_CENTS,
  MAX_EXTENSIONS,
  endsAtAfterBid,
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
  const at = (time: string) => new Date(`2026-11-02T${time}Z`);
  const result = (endsAt: Date, bidAt: string, used: number) => {
    const out = endsAtAfterBid(endsAt, at(bidAt), used);
    return { endsAt: out.endsAt, used: out.extensionCount, extended: out.extended };
  };

  describe("the first extension: a bid in the last 5 minutes sets the end to 15 minutes after it", () => {
    it("leaves the end alone for a bid earlier than that", () => {
      expect(result(end, "11:00:00", 0)).toEqual({ endsAt: end, used: 0, extended: false });
      expect(result(end, "11:54:59", 0)).toEqual({ endsAt: end, used: 0, extended: false });
    });

    it("extends for a bid inside the last 5 minutes, counting it as the first extension", () => {
      expect(result(end, "11:55:00", 0)).toEqual({ endsAt: at("12:10:00"), used: 1, extended: true });
      expect(result(end, "11:57:00", 0)).toEqual({ endsAt: at("12:12:00"), used: 1, extended: true });
      expect(result(end, "11:59:59", 0)).toEqual({ endsAt: at("12:14:59"), used: 1, extended: true });
    });

    it("uses the 15-minute step, not the 5-minute one, for a bid in the last 60 seconds of the original end", () => {
      expect(result(end, "11:59:30", 0)).toEqual({ endsAt: at("12:14:30"), used: 1, extended: true });
    });
  });

  describe("the second extension: after the first, a bid in the last 60 seconds sets the end to 5 minutes after it", () => {
    const extended = at("12:12:00");

    it("ignores a bid that is not in the last 60 seconds, however late it is otherwise", () => {
      expect(result(extended, "12:01:00", 1)).toEqual({ endsAt: extended, used: 1, extended: false });
      expect(result(extended, "12:08:00", 1)).toEqual({ endsAt: extended, used: 1, extended: false });
      expect(result(extended, "12:10:59", 1)).toEqual({ endsAt: extended, used: 1, extended: false });
    });

    it("extends for a bid in the last 60 seconds, counting it as the second and last extension", () => {
      expect(result(extended, "12:11:00", 1)).toEqual({ endsAt: at("12:16:00"), used: 2, extended: true });
      expect(result(extended, "12:11:59", 1)).toEqual({ endsAt: at("12:16:59"), used: 2, extended: true });
    });
  });

  describe("after both extensions", () => {
    it("never moves the end again, however late the bid", () => {
      const last = at("12:16:00");
      for (const time of ["12:00:00", "12:10:00", "12:15:00", "12:15:59"]) {
        expect(result(last, time, 2), time).toEqual({ endsAt: last, used: 2, extended: false });
      }
    });
  });

  it("walks through a whole auction that gets two extensions and then ends on time", () => {
    const first = endsAtAfterBid(end, at("11:58:00"), 0);
    expect(first.endsAt).toEqual(at("12:13:00"));
    const second = endsAtAfterBid(first.endsAt, at("12:12:30"), first.extensionCount);
    expect(second.endsAt).toEqual(at("12:17:30"));
    const third = endsAtAfterBid(second.endsAt, at("12:17:00"), second.extensionCount);
    expect(third).toEqual({ endsAt: at("12:17:30"), extensionCount: 2, extended: false });
  });

  it("never moves the end earlier, and ignores a bid at or after the end", () => {
    for (const used of [0, 1, 2]) {
      for (const time of ["11:00:00", "11:55:00", "11:59:00", "11:59:59"]) {
        expect(endsAtAfterBid(end, at(time), used).endsAt.getTime(), `${time} / ${used}`).toBeGreaterThanOrEqual(end.getTime());
      }
      expect(endsAtAfterBid(end, at("12:00:00"), used).extended).toBe(false);
      expect(endsAtAfterBid(end, at("12:05:00"), used).extended).toBe(false);
    }
  });

  it("is two steps: 5 minutes then 15, and 60 seconds then 5", () => {
    expect(ANTI_SNIPING_STEPS).toEqual([
      { windowMs: 300_000, extensionMs: 900_000 },
      { windowMs: 60_000, extensionMs: 300_000 },
    ]);
    expect(MAX_EXTENSIONS).toBe(2);
  });
});

describe("isFinalChance", () => {
  it("is true only once both extensions have been used", () => {
    expect(isFinalChance(0)).toBe(false);
    expect(isFinalChance(1)).toBe(false);
    expect(isFinalChance(2)).toBe(true);
  });

  it("treats a missing count as none used", () => {
    expect(isFinalChance(undefined)).toBe(false);
    expect(isFinalChance(null)).toBe(false);
  });
});

describe("minimumNextBidCents over the whole range", () => {
  it("always rises by at least €1 and at least 5%, by no more than a cent over that, and fits a 32-bit column", () => {
    for (let current = 1; current <= 400_000; current += 7) {
      const rise = minimumNextBidCents({ startingPriceCents: 100, currentBidCents: current }) - current;
      expect(rise, String(current)).toBeGreaterThanOrEqual(100);
      expect(rise, String(current)).toBeGreaterThanOrEqual(current * 0.05);
      expect(rise, String(current)).toBeLessThan(Math.max(100, current * 0.05) + 1);
    }
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

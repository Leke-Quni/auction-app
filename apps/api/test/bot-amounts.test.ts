import { describe, expect, it } from "vitest";
import { botAmountCents, sampleUser } from "../src/dev/bot-amounts";

// A random source that gives the listed numbers in turn.
const sequence = (...values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length]!;
};

describe("what the bot types", () => {
  it("bids the minimum most of the time, and a little more now and then, as before", () => {
    expect(botAmountCents(1100, false, sequence(0.5))).toBe(1100);
    // 30% of the time: up to 15% more than the minimum, in whole euros.
    expect(botAmountCents(2000, false, sequence(0.1, 0.5))).toBe(2200);
  });

  it("in proxy mode types a hidden maximum between the minimum and five times it, in whole euros", () => {
    for (const [r, expected] of [[0, 1100], [0.5, 3300], [0.999, 5500]] as const) {
      expect(botAmountCents(1100, true, sequence(r)), `random ${r}`).toBe(expected);
    }
  });

  it("in proxy mode never types less than the minimum or more than five times it, and rounds a minimum that is not a whole euro up", () => {
    for (let i = 0; i < 200; i++) {
      const minimum = 100 + Math.floor(Math.random() * 500_000);
      const amount = botAmountCents(minimum, true, Math.random);
      expect(amount).toBeGreaterThanOrEqual(minimum);
      expect(amount).toBeLessThanOrEqual(Math.ceil((minimum * 5) / 100) * 100);
      expect(amount % 100).toBe(0);
    }
  });

  it("in proxy mode often types less than an earlier bot's maximum, so some bids are defended", () => {
    // Each bot's maximum is judged against a leader who typed up to five times an earlier minimum.
    const leaderMax = botAmountCents(1000, true, () => 0.9);
    const below = Array.from({ length: 100 }, (_, i) => botAmountCents(1100, true, () => i / 100)).filter((a) => a < leaderMax);
    expect(below.length).toBeGreaterThan(30);
  });
});

describe("the sample users the bot bids as", () => {
  it("are named exactly as the seed names them, four digits wide", () => {
    expect(sampleUser(1)).toEqual({ id: "seed_user_0001", email: "seed-user-0001@seed.local" });
    expect(sampleUser(40)).toEqual({ id: "seed_user_0040", email: "seed-user-0040@seed.local" });
    expect(sampleUser(1234).id).toBe("seed_user_1234");
  });
});

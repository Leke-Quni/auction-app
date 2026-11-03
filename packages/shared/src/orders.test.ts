import { describe, expect, it } from "vitest";
import { DEFAULT_PLATFORM_FEE_PERCENT, platformFeeCents } from "./orders";

describe("platformFeeCents", () => {
  it("is 5% by default, to the nearest cent", () => {
    expect(DEFAULT_PLATFORM_FEE_PERCENT).toBe(5);
    expect(platformFeeCents(10_000, 5)).toBe(500);
    expect(platformFeeCents(3150, 5)).toBe(158); // 157.5 rounds up
    expect(platformFeeCents(3149, 5)).toBe(157); // 157.45
    expect(platformFeeCents(1, 5)).toBe(0);
    expect(platformFeeCents(10, 5)).toBe(1); // 0.5 rounds up
  });

  it("follows any percentage, including none and fractions", () => {
    expect(platformFeeCents(12_345, 0)).toBe(0);
    expect(platformFeeCents(10_000, 2.5)).toBe(250);
    expect(platformFeeCents(10_000, 100)).toBe(10_000);
  });

  it("never takes more than the price or less than nothing", () => {
    for (const amount of [1, 99, 100, 101, 999_999, 1_000_000_000]) {
      const fee = platformFeeCents(amount, 5);
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(fee).toBeLessThanOrEqual(amount);
    }
  });
});

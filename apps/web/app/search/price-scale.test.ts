import { describe, expect, it } from "vitest";
import { SLIDER_STEPS, eurosToPosition, positionToEuros, sliderMaxEuros } from "./price-scale";

describe("sliderMaxEuros", () => {
  it("rounds the dearest price up to one significant digit, with a floor of 100", () => {
    expect(sliderMaxEuros(undefined)).toBe(100);
    expect(sliderMaxEuros(5000)).toBe(100);
    expect(sliderMaxEuros(123_400)).toBe(2000);
    expect(sliderMaxEuros(20_000_000)).toBe(200_000);
    expect(sliderMaxEuros(20_000_001)).toBe(300_000);
  });
});

describe("price slider scale", () => {
  it("runs from nothing to the maximum, finer at the cheap end", () => {
    expect(positionToEuros(0, 2000)).toBe(0);
    expect(positionToEuros(SLIDER_STEPS, 2000)).toBe(2000);
    expect(positionToEuros(500, 2000)).toBeLessThan(500);
  });

  it("never goes backwards as the thumb moves", () => {
    let last = -1;
    for (let p = 0; p <= SLIDER_STEPS; p += 10) {
      const euros = positionToEuros(p, 200_000);
      expect(euros).toBeGreaterThanOrEqual(last);
      last = euros;
    }
  });

  it("puts a price back where its thumb would be", () => {
    for (const euros of [10, 50, 200, 1000]) {
      const again = positionToEuros(eurosToPosition(euros, 2000), 2000);
      expect(Math.abs(again - euros) / euros).toBeLessThan(0.1);
    }
    expect(eurosToPosition(0, 2000)).toBe(0);
    expect(eurosToPosition(99_999, 2000)).toBe(SLIDER_STEPS);
    expect(eurosToPosition(Number.NaN, 2000)).toBe(0);
  });
});

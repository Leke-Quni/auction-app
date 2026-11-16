import { describe, expect, it } from "vitest";
import { COUNT_FILTER_MAX, MAX_PRICE_CENTS, parseCountFilter, parsePriceFilter } from "./listing-values";

describe("parsePriceFilter", () => {
  it("reads one amount as the start of a price", () => {
    expect(parsePriceFilter("198")).toEqual({ min: 19800, max: 19899 });
    expect(parsePriceFilter("198.8")).toEqual({ min: 19880, max: 19889 });
    expect(parsePriceFilter("198,8")).toEqual({ min: 19880, max: 19889 });
    expect(parsePriceFilter("198.85")).toEqual({ min: 19885, max: 19885 });
    expect(parsePriceFilter(" €45,50 ")).toEqual({ min: 4550, max: 4550 });
    expect(parsePriceFilter("0")).toEqual({ min: 0, max: 99 });
  });

  it("reads closed and open ranges", () => {
    expect(parsePriceFilter("10-50")).toEqual({ min: 1000, max: 5000 });
    expect(parsePriceFilter("€ 10 - € 50.5")).toEqual({ min: 1000, max: 5050 });
    expect(parsePriceFilter("10-")).toEqual({ min: 1000, max: null });
    expect(parsePriceFilter("-50")).toEqual({ min: null, max: 5000 });
    expect(parsePriceFilter("20-20")).toEqual({ min: 2000, max: 2000 });
  });

  it("refuses anything else", () => {
    for (const bad of ["", "   ", "-", "abc", "10-abc", "1-2-3", "50-10", "1.234", "1,000", "--5", "1e3", "NaN", "10 20", "€", "1".repeat(31), String(MAX_PRICE_CENTS / 100 + 1), "0-99999999999999999999"]) {
      expect(parsePriceFilter(bad), bad).toBeNull();
    }
  });

  it("accepts the largest price", () => {
    expect(parsePriceFilter(String(MAX_PRICE_CENTS / 100))).toEqual({ min: MAX_PRICE_CENTS, max: MAX_PRICE_CENTS + 99 });
  });
});

describe("parseCountFilter", () => {
  it("reads one number and ranges", () => {
    expect(parseCountFilter("3")).toEqual({ min: 3, max: 3 });
    expect(parseCountFilter(" 1 - 5 ")).toEqual({ min: 1, max: 5 });
    expect(parseCountFilter("2-")).toEqual({ min: 2, max: null });
    expect(parseCountFilter("-4")).toEqual({ min: null, max: 4 });
    expect(parseCountFilter("0")).toEqual({ min: 0, max: 0 });
  });

  it("refuses anything else", () => {
    for (const bad of ["", "-", "1.5", "1,5", "abc", "5-1", "1-2-3", "1 2", "€3", "1e3", String(COUNT_FILTER_MAX + 1), "99999999999999"]) {
      expect(parseCountFilter(bad), bad).toBeNull();
    }
  });
});

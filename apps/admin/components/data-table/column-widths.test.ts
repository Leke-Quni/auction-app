import { describe, expect, it } from "vitest";
import { moveDivider, percent, readWidths, toShares } from "./column-widths";

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

describe("moveDivider", () => {
  const shares = [0.4, 0.3, 0.2, 0.1];

  it("trades width between the column and the next one only, so every other column and the total stay as they are", () => {
    const next = moveDivider(shares, 1, 0.05, 0.05);
    expect(next[0]).toBe(0.4);
    expect(next[1]).toBeCloseTo(0.35);
    expect(next[2]).toBeCloseTo(0.15);
    expect(next[3]).toBe(0.1);
    expect(sum(next)).toBeCloseTo(1);
  });

  it("moves left as well, growing the next column", () => {
    const next = moveDivider(shares, 0, -0.1, 0.05);
    expect(next[0]).toBeCloseTo(0.3);
    expect(next[1]).toBeCloseTo(0.4);
  });

  it("stops where the next column reaches the minimum", () => {
    const next = moveDivider(shares, 2, 0.5, 0.05);
    expect(next[3]).toBeCloseTo(0.05);
    expect(next[2]).toBeCloseTo(0.25);
    expect(sum(next)).toBeCloseTo(1);
  });

  it("stops where the dragged column reaches the minimum", () => {
    const next = moveDivider(shares, 1, -0.5, 0.05);
    expect(next[1]).toBeCloseTo(0.05);
    expect(next[2]).toBeCloseTo(0.45);
    expect(next[0]).toBe(0.4);
    expect(next[3]).toBe(0.1);
  });

  it("lets a column already below the minimum (a very narrow window) grow but not shrink further", () => {
    const narrow = [0.04, 0.96];
    expect(moveDivider(narrow, 0, -0.01, 0.05)).toEqual(narrow);
    expect(moveDivider(narrow, 0, 0.1, 0.05)[0]).toBeCloseTo(0.14);
  });

  it("has no divider after the last column, and ignores a bad index", () => {
    expect(moveDivider(shares, 3, 0.1, 0.05)).toEqual(shares);
    expect(moveDivider(shares, -1, 0.1, 0.05)).toEqual(shares);
  });
});

describe("toShares", () => {
  it("turns widths in pixels into shares that add up to 1", () => {
    expect(toShares([100, 300])).toEqual([0.25, 0.75]);
    expect(sum(toShares([120, 80, 200]))).toBeCloseTo(1);
  });

  it("shares equally when nothing was measured", () => {
    expect(toShares([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe("readWidths", () => {
  const headers = ["Title", "Seller", "Status"];

  it("reads saved shares for every column", () => {
    expect(readWidths(JSON.stringify({ Title: 0.5, Seller: 0.3, Status: 0.2 }), headers)).toEqual({ Title: 0.5, Seller: 0.3, Status: 0.2 });
  });

  it("counts for nothing when the shares do not add up to 1 (such as widths saved in pixels), a column is missing, or the columns changed", () => {
    expect(readWidths(JSON.stringify({ Title: 300, Seller: 120, Status: 90 }), headers)).toEqual({});
    expect(readWidths(JSON.stringify({ Title: 0.5, Seller: 0.5 }), headers)).toEqual({});
    expect(readWidths(JSON.stringify({ Name: 0.5, Seller: 0.3, Status: 0.2 }), headers)).toEqual({});
    expect(readWidths(JSON.stringify({ Title: 0.7, Seller: 0.3, Status: 0 }), headers)).toEqual({});
  });

  it("counts for nothing when it is empty, not JSON, not numbers, or the table has fewer than two columns", () => {
    expect(readWidths(null, headers)).toEqual({});
    expect(readWidths("nope", headers)).toEqual({});
    expect(readWidths(JSON.stringify({ Title: "wide", Seller: 0.5, Status: 0.5 }), headers)).toEqual({});
    expect(readWidths(JSON.stringify({ Title: 1 }), ["Title"])).toEqual({});
  });
});

describe("percent", () => {
  it("writes a share as a CSS percentage", () => {
    expect(percent(0.25)).toBe("25.000%");
    expect(percent(undefined)).toBe("0.000%");
  });
});

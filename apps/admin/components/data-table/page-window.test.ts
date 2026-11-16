import { describe, expect, it } from "vitest";
import { pageCount, pageWindow } from "./page-window";

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });
  it("skips the middle with a gap, but not a single page", () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(3, 10)).toEqual([1, 2, 3, 4, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe("pageCount", () => {
  it("is at least one page and rounds up", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
  });
});

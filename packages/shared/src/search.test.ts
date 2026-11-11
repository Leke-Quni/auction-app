import { describe, expect, it } from "vitest";
import { resolveSearchSort, searchQuerySchema } from "./search";

describe("searchQuerySchema", () => {
  it("accepts an empty query and fills in the defaults", () => {
    expect(searchQuerySchema.parse({})).toEqual({ q: "", page: 1, pageSize: 24 });
  });

  it("reads filters from query-string text", () => {
    const parsed = searchQuerySchema.parse({
      q: "  watch ",
      category: "watches-jewelry",
      condition: "GOOD",
      minPriceCents: "1000",
      maxPriceCents: "50000",
      endingSoon: "true",
      sort: "priceAsc",
      page: "2",
    });
    expect(parsed).toMatchObject({
      q: "watch",
      category: "watches-jewelry",
      condition: ["GOOD"],
      minPriceCents: 1000,
      maxPriceCents: 50000,
      endingSoon: true,
      sort: "priceAsc",
      page: 2,
    });
  });

  it("reads several conditions from a comma list or a repeated parameter, once each", () => {
    expect(searchQuerySchema.parse({ condition: "NEW,GOOD" }).condition).toEqual(["NEW", "GOOD"]);
    expect(searchQuerySchema.parse({ condition: ["NEW", "FAIR"] }).condition).toEqual(["NEW", "FAIR"]);
    expect(searchQuerySchema.parse({ condition: "NEW, NEW,NEW" }).condition).toEqual(["NEW"]);
    expect(searchQuerySchema.parse({}).condition).toBeUndefined();
  });

  it("rejects bad values", () => {
    for (const bad of [
      { condition: "BROKEN" },
      { condition: "NEW,BROKEN" },
      { condition: "" },
      { condition: "NEW,," },
      { sort: "random" },
      { category: "Watches & Jewelry" },
      { minPriceCents: "-1" },
      { minPriceCents: "abc" },
      { endingSoon: "yes" },
      { page: "0" },
      { pageSize: "500" },
      { minPriceCents: "5000", maxPriceCents: "1000" },
    ]) {
      expect(searchQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("resolveSearchSort", () => {
  it("uses best match for text and newest without text, unless a sort is chosen", () => {
    expect(resolveSearchSort({ q: "watch" })).toBe("relevance");
    expect(resolveSearchSort({ q: "" })).toBe("newest");
    expect(resolveSearchSort({ q: "", sort: "relevance" })).toBe("newest");
    expect(resolveSearchSort({ q: "watch", sort: "priceDesc" })).toBe("priceDesc");
    expect(resolveSearchSort({ q: "", sort: "endingSoon" })).toBe("endingSoon");
  });
});

import { describe, expect, it } from "vitest";
import { maxSearchPage } from "@auction/shared";
import { apiQueryFromParams, categoryHref, pageHref, readSearchParams, SEARCH_PAGE_SIZE } from "./search-params";

describe("readSearchParams", () => {
  it("keeps the first value of a list and drops blank form fields", () => {
    expect(readSearchParams({ q: " watch ", category: "", condition: ["GOOD", "FAIR"], sort: undefined })).toEqual({
      q: "watch",
      condition: "GOOD",
    });
  });
});

describe("apiQueryFromParams", () => {
  it("sends nothing but the paging for an empty search", () => {
    const result = apiQueryFromParams({});
    expect("query" in result && result.query.toString()).toBe("page=1&pageSize=24");
  });

  it("turns euro prices into cents and passes the other filters on", () => {
    const result = apiQueryFromParams({
      q: "watch",
      category: "art",
      condition: "GOOD",
      minPrice: "25",
      maxPrice: "1250,5",
      endingSoon: "true",
      sort: "priceAsc",
      page: "3",
    });
    expect("query" in result && Object.fromEntries(result.query)).toEqual({
      q: "watch",
      category: "art",
      condition: "GOOD",
      minPriceCents: "2500",
      maxPriceCents: "125050",
      endingSoon: "true",
      sort: "priceAsc",
      page: "3",
      pageSize: "24",
    });
  });

  it("explains a price that is not a number, and ignores a bad page number", () => {
    expect(apiQueryFromParams({ minPrice: "cheap" })).toEqual({ error: "Enter prices as a number, like 25 or 25.50." });
    const result = apiQueryFromParams({ page: "-4" });
    expect("query" in result && result.query.get("page")).toBe("1");
    const nonsense = apiQueryFromParams({ page: "abc" });
    expect("query" in nonsense && nonsense.query.get("page")).toBe("1");
  });
});

describe("pageHref", () => {
  it("keeps the search and filters, and leaves page 1 implicit", () => {
    expect(pageHref({ q: "watch", category: "art", page: "2" }, 3)).toBe("/search?q=watch&category=art&page=3");
    expect(pageHref({ q: "watch", page: "2" }, 1)).toBe("/search?q=watch");
  });
});

describe("categoryHref", () => {
  it("switches category, keeps the other filters, and goes back to page 1", () => {
    expect(categoryHref({ q: "watch", condition: "GOOD", category: "art", page: "4" }, "electronics")).toBe(
      "/search?q=watch&category=electronics&condition=GOOD",
    );
  });

  it("clears the category for 'All categories'", () => {
    expect(categoryHref({ q: "watch", category: "art" })).toBe("/search?q=watch");
    expect(categoryHref({ category: "art" })).toBe("/search");
  });
});

describe("page depth", () => {
  it("never asks the API for a page beyond the cap, so a made-up page number cannot be refused", () => {
    const last = maxSearchPage(SEARCH_PAGE_SIZE);
    for (const [page, expected] of [[String(last), last], [String(last + 1), last], ["99999", last], ["0", 1], ["-4", 1], ["abc", 1]] as const) {
      const result = apiQueryFromParams({ page });
      expect("query" in result && result.query.get("page")).toBe(String(expected));
    }
  });
});

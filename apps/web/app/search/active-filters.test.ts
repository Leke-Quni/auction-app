import { describe, expect, it } from "vitest";
import { activeFilterChips, carriedFilters } from "./active-filters";

const categories = [
  { slug: "art", name: "Art" },
  { slug: "watches-jewelry", name: "Watches & Jewelry" },
];

describe("activeFilterChips", () => {
  it("has no chips without filters, and none for the text or the sort", () => {
    expect(activeFilterChips({}, categories)).toEqual([]);
    expect(activeFilterChips({ q: "watch", sort: "priceAsc", page: "3" }, categories)).toEqual([]);
  });

  it("names each filter in words and links to the same search without it", () => {
    const chips = activeFilterChips(
      { q: "watch", category: "watches-jewelry", condition: "LIKE_NEW", minPrice: "25", maxPrice: "300", endingSoon: "true", sort: "priceAsc", page: "2" },
      categories,
    );
    expect(chips.map((c) => [c.label, c.href])).toEqual([
      ["Watches & Jewelry", "/search?q=watch&condition=LIKE_NEW&minPrice=25&maxPrice=300&endingSoon=true&sort=priceAsc"],
      ["Like new", "/search?q=watch&category=watches-jewelry&minPrice=25&maxPrice=300&endingSoon=true&sort=priceAsc"],
      ["€25 – €300", "/search?q=watch&category=watches-jewelry&condition=LIKE_NEW&endingSoon=true&sort=priceAsc"],
      ["Ending within 24 hours", "/search?q=watch&category=watches-jewelry&condition=LIKE_NEW&minPrice=25&maxPrice=300&sort=priceAsc"],
    ]);
  });

  it("words a one-sided price range, and falls back to the slug for an unknown category", () => {
    expect(activeFilterChips({ minPrice: "50" }, categories)[0].label).toBe("From €50");
    expect(activeFilterChips({ maxPrice: "80" }, categories)[0].label).toBe("Up to €80");
    expect(activeFilterChips({ category: "mystery" }, categories)[0].label).toBe("mystery");
  });

  it("goes back to the plain search page when the last filter is removed", () => {
    expect(activeFilterChips({ condition: "GOOD" }, categories)[0].href).toBe("/search");
  });
});

describe("carriedFilters", () => {
  it("keeps the filters and the sort, and drops the text and the page", () => {
    expect(carriedFilters({ q: "old", page: "4", category: "art", maxPrice: "90", sort: "newest" })).toEqual([
      ["category", "art"],
      ["maxPrice", "90"],
      ["sort", "newest"],
    ]);
  });
});

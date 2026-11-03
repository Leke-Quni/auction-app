// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRecentSearch, clearRecentSearches, readRecentSearches, RECENT_SEARCHES_MAX, removeRecentSearch } from "./recent-searches";

beforeEach(() => window.localStorage.clear());

describe("recent searches", () => {
  it("keeps the newest first, trims the text, and ignores nothing-searches", () => {
    addRecentSearch("  watch ");
    addRecentSearch("vase");
    addRecentSearch("   ");
    expect(readRecentSearches()).toEqual(["vase", "watch"]);
  });

  it("moves a repeated search to the top instead of listing it twice, whatever the letter case", () => {
    addRecentSearch("Watch");
    addRecentSearch("vase");
    addRecentSearch("watch");
    expect(readRecentSearches()).toEqual(["watch", "vase"]);
  });

  it("keeps only the latest few", () => {
    for (let i = 1; i <= RECENT_SEARCHES_MAX + 4; i++) addRecentSearch(`item ${i}`);
    const list = readRecentSearches();
    expect(list).toHaveLength(RECENT_SEARCHES_MAX);
    expect(list[0]).toBe(`item ${RECENT_SEARCHES_MAX + 4}`);
  });

  it("forgets one search or all of them", () => {
    addRecentSearch("a");
    addRecentSearch("b");
    expect(removeRecentSearch("a")).toEqual(["b"]);
    expect(clearRecentSearches()).toEqual([]);
    expect(readRecentSearches()).toEqual([]);
  });

  it("copes with damaged storage and with storage that throws", () => {
    window.localStorage.setItem("recent-searches", "{not json");
    expect(readRecentSearches()).toEqual([]);
    window.localStorage.setItem("recent-searches", JSON.stringify(["ok", 5, null, " "]));
    expect(readRecentSearches()).toEqual(["ok"]);
    const broken = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => addRecentSearch("x")).not.toThrow();
    broken.mockRestore();
  });
});

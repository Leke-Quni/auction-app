import { describe, expect, it } from "vitest";
import { LISTING_SYNONYMS, forms, plural } from "../src/search/synonyms";

describe("plural", () => {
  it("makes the usual plurals, and leaves words that already end in s", () => {
    expect(plural("shoe")).toBe("shoes");
    expect(plural("dress")).toBe("dresses");
    expect(plural("watch")).toBe("watches");
    expect(plural("box")).toBe("boxes");
    expect(plural("teddy")).toBe("teddies");
    expect(plural("toy")).toBe("toys");
    expect(plural("shelf")).toBe("shelves");
    expect(plural("bookshelf")).toBe("bookshelves");
    expect(plural("scarf")).toBe("scarves");
    expect(plural("jeans")).toBe("jeans");
    expect(plural("tv")).toBe("tvs");
    expect(plural("board game")).toBe("board games");
  });

  it("lists each word with its plural", () => {
    expect(forms("shoe", "jeans")).toEqual(["shoe", "shoes", "jeans"]);
  });
});

describe("LISTING_SYNONYMS", () => {
  const words = (group: (typeof LISTING_SYNONYMS)[number]) => [...group.synonyms, ...(group.root ? [group.root] : [])];

  it("has unique ids", () => {
    const ids = LISTING_SYNONYMS.map((group) => group.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("uses only plain lower-case words and phrases, which Typesense matches against the listing text", () => {
    for (const group of LISTING_SYNONYMS) {
      for (const word of words(group)) expect(word, `${group.id}: "${word}"`).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    }
  });

  it("has no word repeated inside a group, and never lists a one-way root among its own synonyms", () => {
    for (const group of LISTING_SYNONYMS) {
      const all = words(group);
      expect(all.filter((word, i) => all.indexOf(word) !== i), group.id).toEqual([]);
      expect(group.synonyms.length, group.id).toBeGreaterThan(0);
    }
  });

  it("gives each one-way root a single group, so two rules never compete for the same search word", () => {
    const roots = LISTING_SYNONYMS.flatMap((group) => (group.root ? [group.root] : []));
    expect(roots.filter((root, i) => roots.indexOf(root) !== i)).toEqual([]);
  });

  it("covers the examples people actually search with", () => {
    const find = (id: string) => LISTING_SYNONYMS.find((group) => group.id === id)!;
    expect(find("shoes-shoes").synonyms).toEqual(expect.arrayContaining(["sneakers", "boots", "shoe"]));
    expect(find("shoes-shoes").synonyms).not.toContain("shoes");
    expect(find("bike").synonyms).toEqual(expect.arrayContaining(["bike", "bicycle", "bicycles"]));
    expect(find("watercolour-spelling").synonyms).toContain("watercolor");
  });
});

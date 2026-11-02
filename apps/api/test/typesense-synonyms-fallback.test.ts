import { afterEach, describe, expect, it, vi } from "vitest";
import { TypesenseSearchIndex } from "../src/search/typesense-search-index";

const params = { q: "shoes", page: 1, pageSize: 10, sort: "relevance" as const, endingSoon: false, now: new Date() };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// A stand-in for a Typesense older than 30, which has no synonym sets: everything works except /synonym_sets.
function fakeTypesense(synonymStatus: number) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/synonym_sets/")) return json({ message: "Not Found" }, synonymStatus);
    if (url.includes("/documents/search")) return json({ found: 1, hits: [{ document: { id: "a", title: "Boots" } }] });
    return json({ name: "listings" });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("TypesenseSearchIndex when synonyms cannot be loaded", () => {
  it("still searches, and leaves the synonym set out of the search", async () => {
    const calls = fakeTypesense(404);
    const index = new TypesenseSearchIndex("http://typesense.test", "key", "listings");
    const result = await index.search(params);
    expect(result.total).toBe(1);
    expect(calls.some((call) => call.includes("synonym_sets="))).toBe(false);
    expect(calls.some((call) => call.startsWith("PUT") && call.includes("/synonym_sets/"))).toBe(true);
  });

  it("still indexes", async () => {
    fakeTypesense(400);
    const index = new TypesenseSearchIndex("http://typesense.test", "key", "listings");
    await expect(index.remove("a")).resolves.toBeUndefined();
  });

  it("uses the synonym set when it loads", async () => {
    const calls = fakeTypesense(200);
    const index = new TypesenseSearchIndex("http://typesense.test", "key", "listings");
    await index.search(params);
    expect(calls.some((call) => call.includes("synonym_sets=listing-synonyms"))).toBe(true);
  });
});

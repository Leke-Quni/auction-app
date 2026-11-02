import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSearchSort, type SearchQuery } from "@auction/shared";
import type { ListingDocument, SearchParams } from "../src/search/search-index";
import { TypesenseSearchIndex } from "../src/search/typesense-search-index";

const url = process.env.TYPESENSE_URL ?? "http://localhost:8108";
const apiKey = process.env.TYPESENSE_API_KEY ?? "auction-dev-key";
const collection = `listings_test_${Date.now()}`;
const index = new TypesenseSearchIndex(url, apiKey, collection);

const now = Math.floor(Date.now() / 1000);
const doc = (id: string, over: Partial<ListingDocument> = {}): ListingDocument => ({
  id,
  title: `Listing ${id}`,
  description: "A description",
  category_slug: "art",
  condition: "GOOD",
  price_cents: 1000,
  bid_count: 0,
  starts_at: now - 3600,
  ends_at: now + 3600,
  published_at: now - 3600,
  seller_username: "seller",
  ...over,
});

const raw = (path: string, method = "GET") => fetch(`${url}/collections/${collection}${path}`, { method, headers: { "X-TYPESENSE-API-KEY": apiKey } });
const storedIds = async () => {
  const res = await (await raw("/documents/search?q=*&per_page=250")).json();
  return (res.hits as { document: { id: string } }[]).map((h) => h.document.id).sort();
};

describe("TypesenseSearchIndex (needs Typesense running: docker compose up -d typesense)", () => {
  afterAll(async () => {
    await raw("", "DELETE");
  });

  beforeAll(async () => {
    await index.ensureReady();
  });

  it("creates its collection once and can be asked again", async () => {
    await index.ensureReady();
    await new TypesenseSearchIndex(url, apiKey, collection).ensureReady();
    expect((await raw("")).status).toBe(200);
  });

  it("upserts a document, replacing it when the id repeats", async () => {
    await index.upsert(doc("a", { title: "First title" }));
    await index.upsert(doc("a", { title: "Second title" }));
    const stored = await (await raw("/documents/a")).json();
    expect(stored.title).toBe("Second title");
  });

  it("removes a document, and does not mind one that is missing", async () => {
    await index.upsert(doc("b"));
    await index.remove("b");
    await index.remove("b");
    expect((await raw("/documents/b")).status).toBe(404);
  });

  it("removes ended auctions only", async () => {
    await index.upsert(doc("ended", { ends_at: now - 10 }));
    await index.upsert(doc("live", { ends_at: now + 600 }));
    await index.removeEnded(new Date());
    const ids = await storedIds();
    expect(ids).toContain("live");
    expect(ids).not.toContain("ended");
  });

  it("replaces everything with the given set, and empties the index for an empty set", async () => {
    await index.replaceAll([doc("x"), doc("y")]);
    expect(await storedIds()).toEqual(["x", "y"]);
    await index.replaceAll([doc("y"), doc("z")]);
    expect(await storedIds()).toEqual(["y", "z"]);
    await index.replaceAll([]);
    expect(await storedIds()).toEqual([]);
  });

  it("reports an error when the server rejects a document", async () => {
    await expect(index.replaceAll([{ ...doc("bad"), price_cents: "free" as unknown as number }])).rejects.toThrow(/rejected 1 documents/);
  });
});

describe("TypesenseSearchIndex.search", () => {
  const searchCollection = new TypesenseSearchIndex(url, apiKey, `listings_search_test_${Date.now()}`);
  const HOUR = 3600;

  const run = async (query: Partial<SearchQuery> = {}) => {
    const full = { q: "", page: 1, pageSize: 24, ...query };
    const params: SearchParams = { ...full, sort: resolveSearchSort(full), endingSoon: full.endingSoon ?? false, now: new Date() };
    const { documents, total } = await searchCollection.search(params);
    return { titles: documents.map((d) => d.title), total };
  };

  beforeAll(async () => {
    await searchCollection.replaceAll([
      doc("watch", { title: "Vintage wristwatch", description: "Serviced, original strap", category_slug: "watches-jewelry", condition: "GOOD", price_cents: 25000, bid_count: 2, ends_at: now + 2 * HOUR, published_at: now - 500 }),
      doc("camera", { title: "Film camera", description: "Works well, light scratches", category_slug: "electronics", condition: "FAIR", price_cents: 8000, bid_count: 9, ends_at: now + 3 * 24 * HOUR, published_at: now - 300 }),
      doc("vase", { title: "Blue ceramic vase", description: "A wristwatch-sized dent", category_slug: "home-garden", condition: "LIKE_NEW", price_cents: 4000, bid_count: 0, ends_at: now + 5 * 24 * HOUR, published_at: now - 100 }),
      doc("future", { title: "Upcoming painting", category_slug: "art", condition: "NEW", price_cents: 90000, starts_at: now + 24 * HOUR, ends_at: now + 4 * 24 * HOUR, published_at: now - 700 }),
      doc("over", { title: "Already over wristwatch", ends_at: now - 60 }),
    ]);
  });

  afterAll(async () => {
    await fetch(`${url}/collections/${searchCollection.collection}`, { method: "DELETE", headers: { "X-TYPESENSE-API-KEY": apiKey } });
  });

  it("returns live and upcoming listings, newest first, and never an ended one", async () => {
    expect((await run()).titles).toEqual(["Blue ceramic vase", "Film camera", "Vintage wristwatch", "Upcoming painting"]);
  });

  it("forgives typos and partial words", async () => {
    expect((await run({ q: "wrstwatch" })).titles).toContain("Vintage wristwatch");
    expect((await run({ q: "ceram" })).titles).toEqual(["Blue ceramic vase"]);
  });

  it("ranks a title match above a description match", async () => {
    expect((await run({ q: "wristwatch" })).titles).toEqual(["Vintage wristwatch", "Blue ceramic vase"]);
  });

  it("finds nothing for text that matches nothing", async () => {
    expect(await run({ q: "zzzzqqqq" })).toEqual({ titles: [], total: 0 });
  });

  it("filters by category, condition and price range", async () => {
    expect((await run({ category: "electronics" })).titles).toEqual(["Film camera"]);
    expect((await run({ condition: "LIKE_NEW" })).titles).toEqual(["Blue ceramic vase"]);
    expect((await run({ minPriceCents: 5000, maxPriceCents: 30000, sort: "priceAsc" })).titles).toEqual(["Film camera", "Vintage wristwatch"]);
    expect((await run({ category: "electronics", condition: "NEW" })).titles).toEqual([]);
  });

  it("'ending soon' means live and ending within 24 hours", async () => {
    expect((await run({ endingSoon: true })).titles).toEqual(["Vintage wristwatch"]);
  });

  it("sorts by ending time, bids and price", async () => {
    expect((await run({ sort: "endingSoon" })).titles).toEqual(["Vintage wristwatch", "Film camera", "Upcoming painting", "Blue ceramic vase"]);
    expect((await run({ sort: "mostBids" })).titles.slice(0, 2)).toEqual(["Film camera", "Vintage wristwatch"]);
    expect((await run({ sort: "priceDesc" })).titles[0]).toBe("Upcoming painting");
    expect((await run({ sort: "priceAsc" })).titles[0]).toBe("Blue ceramic vase");
  });

  it("pages through results and reports the total", async () => {
    const first = await run({ pageSize: 3 });
    const second = await run({ pageSize: 3, page: 2 });
    expect(first.total).toBe(4);
    expect(first.titles).toHaveLength(3);
    expect(second.titles).toHaveLength(1);
    expect(second.titles[0]).not.toBe(first.titles[0]);
  });
});

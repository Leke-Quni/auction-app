import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSearchSort, type SearchQuery } from "@auction/shared";
import type { ListingDocument, SearchParams } from "../src/search/search-index";
import { TypesenseSearchIndex, normalizeQuery } from "../src/search/typesense-search-index";

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

  it("updates the live fields of a document and leaves the rest, and does not mind a missing one", async () => {
    await index.upsert(doc("u", { title: "Keep this title", price_cents: 1000, bid_count: 0 }));
    await index.update("u", { price_cents: 1500, bid_count: 2, final_chance: true, ends_at: now + 7200 });
    const stored = await (await raw("/documents/u")).json();
    expect(stored).toMatchObject({ title: "Keep this title", price_cents: 1500, bid_count: 2, final_chance: true, ends_at: now + 7200, seller_username: "seller" });
    await expect(index.update("no-such-document", { price_cents: 1, bid_count: 1, final_chance: false, ends_at: now + 60 })).resolves.toBeUndefined();
    expect((await raw("/documents/no-such-document")).status).toBe(404);
  });

  it("keeps an auction in the index after an update moved its end past now, where the sweep would have removed it", async () => {
    await index.upsert(doc("extended", { ends_at: now + 5 }));
    await index.update("extended", { price_cents: 1000, bid_count: 1, final_chance: false, ends_at: now + 600 });
    await index.removeEnded(new Date((now + 30) * 1000));
    expect(await storedIds()).toContain("extended");
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

  it("returns live and upcoming listings, never an ended one, most active first and then soonest ending when there is no text", async () => {
    expect((await run()).titles).toEqual(["Film camera", "Vintage wristwatch", "Upcoming painting", "Blue ceramic vase"]);
  });

  it("still lists newest first when newest is asked for", async () => {
    expect((await run({ sort: "newest" })).titles).toEqual(["Blue ceramic vase", "Film camera", "Vintage wristwatch", "Upcoming painting"]);
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
    expect((await run({ condition: ["LIKE_NEW"] })).titles).toEqual(["Blue ceramic vase"]);
    expect((await run({ condition: ["LIKE_NEW", "FAIR"] })).titles).toEqual(["Film camera", "Blue ceramic vase"]);
    expect((await run({ minPriceCents: 5000, maxPriceCents: 30000, sort: "priceAsc" })).titles).toEqual(["Film camera", "Vintage wristwatch"]);
    expect((await run({ category: "electronics", condition: ["NEW"] })).titles).toEqual([]);
  });

  it("'ending soon' means live and ending within 24 hours", async () => {
    expect((await run({ endingSoon: true })).titles).toEqual(["Vintage wristwatch"]);
  });

  it("sorts by ending time, bids and price", async () => {
    expect((await run({ sort: "endingSoon" })).titles).toEqual(["Vintage wristwatch", "Film camera", "Upcoming painting", "Blue ceramic vase"]);
    expect((await run({ sort: "endingLatest" })).titles).toEqual(["Blue ceramic vase", "Film camera", "Vintage wristwatch"]);
    expect((await run({ sort: "mostBids" })).titles.slice(0, 2)).toEqual(["Film camera", "Vintage wristwatch"]);
    expect((await run({ sort: "fewestBids" })).titles).toEqual(["Upcoming painting", "Blue ceramic vase", "Vintage wristwatch", "Film camera"]);
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

describe("normalizeQuery", () => {
  it("cuts three or more of the same letter in a row to two, and leaves everything else alone", () => {
    expect(normalizeQuery("jjjjeans")).toBe("jjeans");
    expect(normalizeQuery("JJJeans")).toBe("JJeans");
    expect(normalizeQuery("heeeello woorld")).toBe("heello woorld");
    expect(normalizeQuery("balloon coffee")).toBe("balloon coffee");
    expect(normalizeQuery("1000000 euros")).toBe("1000000 euros");
    expect(normalizeQuery("")).toBe("");
  });
});

describe("TypesenseSearchIndex.search typo tolerance", () => {
  const typoIndex = new TypesenseSearchIndex(url, apiKey, `listings_typo_test_${Date.now()}`);
  const find = async (q: string) =>
    (await typoIndex.search({ q, page: 1, pageSize: 10, sort: "relevance", endingSoon: false, now: new Date() })).documents.map((d) => d.title);

  beforeAll(async () => {
    await typoIndex.replaceAll([
      doc("jeans", { title: "Denim jeans", description: "Size M" }),
      doc("painting", { title: "Oil painting", description: "Framed" }),
    ]);
  });

  afterAll(async () => {
    await fetch(`${url}/collections/${typoIndex.collection}`, { method: "DELETE", headers: { "X-TYPESENSE-API-KEY": apiKey } });
  });

  it("finds a word with extra repeated letters, however many", async () => {
    expect(await find("jjjjeans")).toEqual(["Denim jeans"]);
    expect(await find("jjjjjjeans")).toEqual(["Denim jeans"]);
  });

  it("allows one typo in a short word and two in a word of six or more letters", async () => {
    expect(await find("jeanz")).toEqual(["Denim jeans"]);
    expect(await find("jeanzz")).toEqual(["Denim jeans"]);
    expect(await find("xxinting")).toEqual(["Oil painting"]);
  });

  it("does not allow two typos in a five-letter word, which would match unrelated words", async () => {
    expect(await find("jxanz")).toEqual([]);
  });
});

describe("TypesenseSearchIndex.search synonyms", () => {
  const synonymIndex = new TypesenseSearchIndex(url, apiKey, `listings_synonym_test_${Date.now()}`);
  const find = async (q: string) =>
    (await synonymIndex.search({ q, page: 1, pageSize: 10, sort: "relevance", endingSoon: false, now: new Date() })).documents
      .map((d) => d.title)
      .sort();

  beforeAll(async () => {
    await synonymIndex.replaceAll([
      doc("sneakers", { title: "Leather sneakers", description: "Size 42" }),
      doc("boots", { title: "Ankle boots", description: "Brown" }),
      doc("bicycle", { title: "Road bicycle", description: "Light frame" }),
      doc("painting", { title: "Watercolour landscape", description: "Framed" }),
      doc("lamp", { title: "Floor lamp", description: "Brass" }),
    ]);
  });

  afterAll(async () => {
    await fetch(`${url}/collections/${synonymIndex.collection}`, { method: "DELETE", headers: { "X-TYPESENSE-API-KEY": apiKey } });
  });

  it("finds specific items from a general word", async () => {
    expect(await find("shoes")).toEqual(["Ankle boots", "Leather sneakers"]);
    expect(await find("footwear")).toEqual(["Ankle boots", "Leather sneakers"]);
  });

  it("works one way: a specific word does not pull in the others", async () => {
    expect(await find("sneakers")).toEqual(["Leather sneakers"]);
    expect(await find("boots")).toEqual(["Ankle boots"]);
  });

  it("treats equivalent words and spellings the same", async () => {
    expect(await find("bike")).toEqual(["Road bicycle"]);
    expect(await find("watercolor")).toEqual(["Watercolour landscape"]);
  });

  it("still finds nothing for a word without synonyms", async () => {
    expect(await find("submarine")).toEqual([]);
  });
});

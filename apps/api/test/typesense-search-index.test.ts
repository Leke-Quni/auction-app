import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ListingDocument } from "../src/search/search-index";
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

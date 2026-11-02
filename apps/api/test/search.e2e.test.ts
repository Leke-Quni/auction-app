import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { SEARCH_INDEX, type ListingDocument, type SearchIndex, type SearchParams } from "../src/search/search-index";

const now = Math.floor(Date.now() / 1000);
const doc = (over: Partial<ListingDocument>): ListingDocument => ({
  id: "L1",
  title: "Vintage wristwatch",
  description: "Serviced",
  category_slug: "watches-jewelry",
  condition: "GOOD",
  price_cents: 2500,
  bid_count: 3,
  starts_at: now - 3600,
  ends_at: now + 3600,
  published_at: now - 3600,
  seller_username: "seller",
  cover_url: "https://abc.public.blob.vercel-storage.com/listings/u1/a.jpg",
  ...over,
});

let documents: ListingDocument[] = [];
let failing = false;
let lastParams: SearchParams | undefined;
const fakeSearch: SearchIndex = {
  async ensureReady() {},
  async upsert() {},
  async remove() {},
  async removeEnded() {},
  async replaceAll() {},
  async search(params) {
    lastParams = params;
    if (failing) throw new Error("search is down");
    return { documents, total: documents.length };
  },
};

describe("GET /search", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SEARCH_INDEX).useValue(fakeSearch).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("is public and returns items shaped like the listings list, so the same card can show them", async () => {
    documents = [doc({}), doc({ id: "L2", title: "Upcoming art", starts_at: now + 3600, ends_at: now + 7200, cover_url: undefined })];
    const res = await api().get("/search?q=watch").expect(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 24 });
    expect(res.body.items[0]).toEqual({
      id: "L1",
      title: "Vintage wristwatch",
      startingPriceCents: 2500,
      bidCount: 3,
      currentBidCents: 2500,
      extensionCount: 0,
      phase: "live",
      startsAt: new Date((now - 3600) * 1000).toISOString(),
      endsAt: new Date((now + 3600) * 1000).toISOString(),
      images: [{ id: "L1-cover", url: "https://abc.public.blob.vercel-storage.com/listings/u1/a.jpg" }],
    });
    expect(res.body.items[1]).toMatchObject({ phase: "upcoming", images: [] });
  });

  it("passes the filters through, and picks best match with text and newest without", async () => {
    await api().get("/search?q=watch&category=art&condition=FAIR&minPriceCents=100&maxPriceCents=900&endingSoon=true&page=2&pageSize=10").expect(200);
    expect(lastParams).toMatchObject({
      q: "watch",
      category: "art",
      condition: "FAIR",
      minPriceCents: 100,
      maxPriceCents: 900,
      endingSoon: true,
      sort: "relevance",
      page: 2,
      pageSize: 10,
    });
    await api().get("/search").expect(200);
    expect(lastParams).toMatchObject({ q: "", sort: "newest", endingSoon: false });
    await api().get("/search?sort=priceAsc").expect(200);
    expect(lastParams?.sort).toBe("priceAsc");
  });

  it("rejects bad input with a 400", async () => {
    await api().get("/search?condition=BROKEN").expect(400);
    await api().get("/search?sort=random").expect(400);
    await api().get("/search?minPriceCents=5000&maxPriceCents=100").expect(400);
    await api().get("/search?pageSize=500").expect(400);
  });

  it("says 503 when the search server fails", async () => {
    failing = true;
    await api().get("/search?q=watch").expect(503);
    failing = false;
  });
});

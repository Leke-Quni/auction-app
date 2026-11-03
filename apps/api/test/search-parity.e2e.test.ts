import "../src/config";
import { createPrismaClient } from "@auction/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../src/db/db.module";
import { PostgresSearchIndex } from "../src/search/postgres-search-index";
import type { ListingDocument, SearchParams } from "../src/search/search-index";
import { TypesenseSearchIndex } from "../src/search/typesense-search-index";

// The Postgres search stands in for Typesense where Typesense is not available, so the same listings and the same typed
// text should give the same listings from both. Needs Typesense running: docker compose up -d typesense.
const HOUR = 3600_000;
const stamp = Date.now().toString(36);
const PRICE = 7_654_322;

const LISTINGS: [title: string, description: string][] = [
  ["Vintage brass lamp", "A heavy desk lamp"],
  ["Leather sneakers", "Worn twice"],
  ["Stringed instrument", "A small violin"],
  ["Gold ring", "Size 7"],
  ["Board game classic", "Complete set"],
  ["Silver necklace", "Sterling silver chain"],
  ["Waterproof hiking boots", "Great for rain"],
  ["Watercolour landscape", "Original painting"],
  ["Wooden chair", "Solid oak"],
  ["Retro television", "Works well"],
];

const QUERIES = [
  "brass",
  "bra",
  "vintage lamp",
  "lamp vintage",
  "brasss",
  "vintge",
  "lether",
  "lxxther",
  "ring",
  "rin",
  "shoes",
  "shoe",
  "trainers",
  "sneaker",
  "boardgame",
  "board game",
  "jewellery",
  "jewelry",
  "watercolor",
  "colour",
  "tv",
  "television",
  "old",
  "wood",
  "violin",
  "chair oak",
  "silver chain",
  "brass zzzzzzqq",
  "zzzzzzqq",
  "brasssss",
  "waterpoof",
];

describe("Typesense and Postgres search give the same results", () => {
  const prisma: Prisma = createPrismaClient();
  const postgres = new PostgresSearchIndex(prisma);
  const typesense = new TypesenseSearchIndex(process.env.TYPESENSE_URL ?? "http://localhost:8108", process.env.TYPESENSE_API_KEY ?? "auction-dev-key", `listings_parity_${stamp}`);
  const sellerId = `parity_${stamp}`;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: sellerId, email: `${sellerId}@example.com`, firstName: "S", lastName: "S", username: `pa${stamp}`, passwordHash: "!test", emailVerified: new Date() } });
    const categoryId = (await prisma.category.findFirstOrThrow()).id;
    const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
    const now = Date.now();
    await typesense.ensureReady();
    for (const [title, description] of LISTINGS) {
      const listing = await prisma.listing.create({
        data: { sellerId, title, description, categoryId, condition: "GOOD", startingPriceCents: PRICE, durationDays: 3, status: "PUBLISHED", startsAt: new Date(now - HOUR), endsAt: new Date(now + 48 * HOUR), publishedAt: new Date(now - HOUR) },
      });
      const doc: ListingDocument = {
        id: listing.id,
        title,
        description,
        category_slug: category.slug,
        condition: "GOOD",
        price_cents: PRICE,
        bid_count: 0,
        starts_at: Math.floor((now - HOUR) / 1000),
        ends_at: Math.floor((now + 48 * HOUR) / 1000),
        published_at: Math.floor((now - HOUR) / 1000),
        seller_username: `pa${stamp}`,
      };
      await typesense.upsert(doc);
    }
  });

  afterAll(async () => {
    await fetch(`${process.env.TYPESENSE_URL ?? "http://localhost:8108"}/collections/listings_parity_${stamp}`, { method: "DELETE", headers: { "X-TYPESENSE-API-KEY": process.env.TYPESENSE_API_KEY ?? "auction-dev-key" } });
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: sellerId } });
    await prisma.$disconnect();
  });

  const ask = async (index: PostgresSearchIndex | TypesenseSearchIndex, q: string) => {
    const params: SearchParams = { q, sort: "relevance", endingSoon: false, page: 1, pageSize: 50, minPriceCents: PRICE, maxPriceCents: PRICE, now: new Date() };
    return (await index.search(params)).documents.map((d) => d.title).sort();
  };

  it.each(QUERIES)("%s", async (q) => {
    expect(await ask(postgres, q)).toEqual(await ask(typesense, q));
  });
});

import "../src/config";
import { createPrismaClient } from "@auction/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../src/db/db.module";
import { PostgresSearchIndex } from "../src/search/postgres-search-index";
import type { SearchParams } from "../src/search/search-index";

const HOUR = 3600_000;

describe("PostgresSearchIndex", () => {
  const prisma: Prisma = createPrismaClient();
  const index = new PostgresSearchIndex(prisma);
  const stamp = Date.now().toString(36);
  const word = `zq${stamp}`;
  const sellerId = `pgsearch_${stamp}`;
  const ids: Record<string, string> = {};

  const find = async (over: Partial<SearchParams> = {}) =>
    (await index.search({ q: word, sort: "newest", endingSoon: false, page: 1, pageSize: 24, now: new Date(), ...over })).documents.map((d) => d.title);

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: sellerId, email: `${sellerId}@example.com`, firstName: "S", lastName: "S", username: `pg${stamp}`, passwordHash: "!test", emailVerified: new Date() },
    });
    const category = async (slug: string) => (await prisma.category.findFirstOrThrow({ where: { slug } })).id;
    const now = Date.now();
    const make = async (title: string, over: Record<string, unknown>) => {
      const listing = await prisma.listing.create({
        data: {
          sellerId,
          title,
          description: "Plain description",
          categoryId: await category("collectibles"),
          condition: "GOOD",
          startingPriceCents: 1000,
          durationDays: 3,
          status: "PUBLISHED",
          startsAt: new Date(now - HOUR),
          endsAt: new Date(now + 48 * HOUR),
          publishedAt: new Date(now - HOUR),
          ...over,
        },
      });
      ids[title] = listing.id;
    };
    await make(`${word} cheap good`, {});
    await make(`${word} pricey new`, { condition: "NEW", startingPriceCents: 9000, categoryId: await category("art"), publishedAt: new Date(now - 2 * HOUR) });
    await make(`${word} soon`, { endsAt: new Date(now + 2 * HOUR), bidCount: 2, currentBidCents: 1500, highBidderId: sellerId });
    await make(`${word} upcoming`, { startsAt: new Date(now + 5 * HOUR), endsAt: new Date(now + 53 * HOUR) });
    await make(`${word} ended`, { endsAt: new Date(now - HOUR) });
    await make(`${word} draft`, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: sellerId } });
    await prisma.$disconnect();
  });

  it("finds live and upcoming listings by word, never ended or draft ones", async () => {
    expect((await find()).sort()).toEqual([`${word} cheap good`, `${word} pricey new`, `${word} soon`, `${word} upcoming`].sort());
  });

  it("matches partial words and every word typed", async () => {
    expect(await find({ q: `${word.slice(0, -2)} PRICEY` })).toEqual([`${word} pricey new`]);
    expect(await find({ q: "100%" })).toEqual([]);
  });

  it("filters by condition, category, price (current bid once there are bids) and ending soon", async () => {
    expect(await find({ condition: "NEW" })).toEqual([`${word} pricey new`]);
    expect(await find({ category: "art" })).toEqual([`${word} pricey new`]);
    expect(await find({ minPriceCents: 1200, maxPriceCents: 2000 })).toEqual([`${word} soon`]);
    expect(await find({ minPriceCents: 1000, maxPriceCents: 1000 })).toEqual([`${word} cheap good`, `${word} upcoming`].sort());
    expect(await find({ endingSoon: true })).toEqual([`${word} soon`]);
  });

  it("sorts and pages, and reports the total", async () => {
    expect((await find({ sort: "priceDesc" }))[0]).toBe(`${word} pricey new`);
    expect((await find({ sort: "endingSoon" }))[0]).toBe(`${word} soon`);
    expect((await find({ sort: "mostBids" }))[0]).toBe(`${word} soon`);
    const page = await index.search({ q: word, sort: "newest", endingSoon: false, page: 2, pageSize: 3, now: new Date() });
    expect(page.total).toBe(4);
    expect(page.documents).toHaveLength(1);
  });

  it("returns the fields a card needs", async () => {
    const [doc] = (await index.search({ q: `${word} soon`, sort: "newest", endingSoon: false, page: 1, pageSize: 5, now: new Date() })).documents;
    expect(doc).toMatchObject({ id: ids[`${word} soon`], price_cents: 1500, bid_count: 2, category_slug: "collectibles", condition: "GOOD", final_chance: false });
  });
});

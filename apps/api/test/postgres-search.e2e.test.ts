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
    // Characters that mean something to LIKE or to a regular expression are only ever plain text.
    for (const q of ["%%%", "_", ".*", "(", "[a-z]+", "\\"]) expect(await find({ q })).toEqual([]);
  });

  describe("matches the way Typesense does", () => {
    // These listings share a price nobody else has, so a search can be limited to them whatever else is in the database.
    const PRICE = 7_654_321;
    const extra: string[] = [];
    beforeAll(async () => {
      const categoryId = (await prisma.category.findFirstOrThrow()).id;
      const make = async (title: string, description = "Plain description") => {
        const listing = await prisma.listing.create({
          data: { sellerId, title, description, categoryId, condition: "GOOD", startingPriceCents: PRICE, durationDays: 3, status: "PUBLISHED", startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + 48 * HOUR), publishedAt: new Date(Date.now() - HOUR) },
        });
        extra.push(listing.id);
      };
      await make("vintage brass lamp");
      await make("leather sneakers");
      await make("stringed instrument", "A violin");
      await make("ring");
      await make("board game");
    });
    const only = async (q: string) => (await find({ q, minPriceCents: PRICE, maxPriceCents: PRICE })).sort();

    it("matches whole words and the start of the last word, not the middle of a word", async () => {
      expect(await only("brass")).toEqual(["vintage brass lamp"]);
      expect(await only("bra")).toEqual(["vintage brass lamp"]);
      expect(await only("ring")).toEqual(["ring"]); // not "stringed"
      expect(await only("atch")).toEqual([]);
    });

    it("forgives one typo from 4 letters and two from 6, but none in shorter words", async () => {
      expect(await only("brasss")).toEqual(["vintage brass lamp"]); // one extra letter
      expect(await only("vintge")).toEqual(["vintage brass lamp"]); // one missing
      expect(await only("lether")).toEqual(["leather sneakers"]);
      expect(await only("lxther")).toEqual(["leather sneakers"]);
      expect(await only("lxxther")).toEqual(["leather sneakers"]); // two wrong, six letters
      expect(await only("rxng")).toEqual(["ring"]); // four letters allow one typo
      expect(await only("rxxg")).toEqual([]); // but not two
      expect(await only("lxx")).toEqual([]); // and a three-letter word none
    });

    it("finds synonyms, one way only for a general word, and phrases", async () => {
      expect(await only("shoes")).toEqual(["leather sneakers"]); // "shoes" finds sneakers
      expect(await only("sneakers")).toEqual(["leather sneakers"]);
      expect(await only("trainers")).toEqual(["leather sneakers"]); // sneakers and trainers mean the same
      expect(await only("boardgame")).toEqual(["board game"]);
      expect(await only("shoe")).toEqual(["leather sneakers"]);
    });

    it("keeps three or more repeated letters from defeating a search", async () => {
      expect(await only("brasssss")).toEqual(["vintage brass lamp"]);
    });

    it("falls back to the listings that match the most words when none matches them all", async () => {
      expect(await only("brass zzzzzzqq")).toEqual(["vintage brass lamp"]);
      expect(await only("zzzzzzqq brass")).toEqual(["vintage brass lamp"]);
      expect(await only("zzzzzzqq")).toEqual([]);
      // Listings that match both words are all there is when some do.
      expect(await only("vintage lamp")).toEqual(["vintage brass lamp"]);
    });

    it("ranks title matches first", async () => {
      expect(await only("violin")).toEqual(["stringed instrument"]); // only the description has it
    });
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
    expect((await find({ sort: "endingLatest" }))[0]).toBe(`${word} upcoming`);
    const fewest = await find({ sort: "fewestBids" });
    expect(fewest.at(-1)).toBe(`${word} soon`);
    expect(fewest[0]).not.toBe(`${word} soon`);
    const page = await index.search({ q: word, sort: "newest", endingSoon: false, page: 2, pageSize: 3, now: new Date() });
    expect(page.total).toBe(4);
    expect(page.documents).toHaveLength(1);
  });

  it("returns the fields a card needs", async () => {
    const [doc] = (await index.search({ q: `${word} soon`, sort: "newest", endingSoon: false, page: 1, pageSize: 5, now: new Date() })).documents;
    expect(doc).toMatchObject({ id: ids[`${word} soon`], price_cents: 1500, bid_count: 2, category_slug: "collectibles", condition: "GOOD", final_chance: false });
  });
});

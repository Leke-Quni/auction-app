import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { SEARCH_INDEX, type LiveFields, type SearchIndex } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const updates: { id: string; fields: LiveFields }[] = [];

const recordingIndex: SearchIndex = {
  async ensureReady() {},
  async upsert() {},
  async update(id, fields) {
    updates.push({ id, fields });
  },
  async remove() {},
  async removeEnded() {},
  async replaceAll() {},
  async search() {
    return { documents: [], total: 0 };
  },
};

describe("search index follows bids", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let categoryId: string;
  let seller: { id: string };
  const bidders: { id: string; token: string }[] = [];
  const saved = process.env.SEARCH_PRICE_THROTTLE_SECONDS;

  const makePerson = async (n: number) => {
    const row = { id: `ss_${stamp}_${n}`, email: `ss-${n}-${stamp}@example.com`, firstName: "S", lastName: "S", username: `ss${n}x${stamp}`, passwordHash: "!t", emailVerified: new Date() };
    await prisma.user.create({ data: row });
    const token = await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret());
    return { id: row.id, token };
  };
  const makeListing = (endsInMs: number) =>
    prisma.listing.create({
      data: {
        sellerId: seller.id, title: "Search sync listing", description: "A listing for the search sync tests.", categoryId, condition: "GOOD",
        startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + endsInMs), publishedAt: new Date(Date.now() - DAY),
      },
    });
  const bid = (who: { token: string }, listingId: string, amountCents: number) =>
    request(app.getHttpServer()).post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${who.token}`).send({ amountCents, idempotencyKey: randomUUID() });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  beforeAll(async () => {
    process.env.SEARCH_PRICE_THROTTLE_SECONDS = "60";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SEARCH_INDEX).useValue(recordingIndex).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    seller = await makePerson(0);
    for (let n = 1; n <= 3; n++) bidders.push(await makePerson(n));
  });

  afterAll(async () => {
    process.env.SEARCH_PRICE_THROTTLE_SECONDS = saved;
    const mine = { email: { startsWith: "ss-", endsWith: `-${stamp}@example.com` } };
    await prisma.bidAudit.deleteMany({ where: { userId: { startsWith: `ss_${stamp}_` } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  it("updates the indexed price and bid count after a bid, and holds the next ones back", async () => {
    const listing = await makeListing(2 * DAY);
    await bid(bidders[0], listing.id, 1000).expect(201);
    await settle();
    await bid(bidders[1], listing.id, 1200).expect(201);
    await settle();
    const mine = updates.filter((u) => u.id === listing.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].fields).toMatchObject({ price_cents: 1000, bid_count: 1, final_chance: false });
  });

  it("pushes an extension at once, with the new end time", async () => {
    const listing = await makeListing(90_000);
    await bid(bidders[0], listing.id, 1000).expect(201);
    await settle();
    await bid(bidders[1], listing.id, 1200).expect(201); // extends again, inside the window (a takeover is one step above the old maximum: 11.00)
    await settle();
    const mine = updates.filter((u) => u.id === listing.id);
    expect(mine).toHaveLength(2);
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(mine[1].fields).toMatchObject({ price_cents: 1100, bid_count: 2, ends_at: Math.floor(row.endsAt!.getTime() / 1000) });
    expect(mine[1].fields.ends_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 100);
  });
});

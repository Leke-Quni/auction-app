import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { AuctionEvents, type AuctionEvent } from "../src/bids/auction-events";
import { BidsService } from "../src/bids/bids.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const SECOND = 1000;
let counter = 0;

describe("closing auctions", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let categoryId: string;
  let seller: { id: string };
  let buyer: { id: string; username: string };
  let closed: Extract<AuctionEvent, { type: "AuctionClosed" }>[] = [];
  const created: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    app.get(AuctionEvents).stream.subscribe((event) => {
      // The app's own sweep also closes old sample listings in a shared database; only this file's listings count.
      if (event.type === "AuctionClosed" && created.includes(event.listingId)) closed.push(event);
    });
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller, buyer] = await makePeople(2);
  });

  beforeEach(() => {
    closed = [];
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "close-", endsWith: `-${stamp}@example.com` } };
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePeople = async (count: number) => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return { id: `close_${stamp}_${n}`, email: `close-${n}-${stamp}@example.com`, firstName: "Close", lastName: "Tester", username: `cl${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    });
    await prisma.user.createMany({ data: rows });
    return rows;
  };

  const makeListing = async (over: Record<string, unknown> = {}) => {
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Close test listing",
        description: "A listing for the close tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - 4 * DAY),
        endsAt: new Date(Date.now() - SECOND),
        publishedAt: new Date(Date.now() - 4 * DAY),
        ...over,
      },
    });
    created.push(listing.id);
    return listing;
  };

  const withBid = (cents: number, over: Record<string, unknown> = {}) => makeListing({ currentBidCents: cents, bidCount: 1, highBidderId: buyer.id, ...over });
  const stored = (id: string) => prisma.listing.findUniqueOrThrow({ where: { id } });

  it("closes an ended auction with no bids as NO_BIDS", async () => {
    const listing = await makeListing();
    expect(await closer.close(listing.id)).toBe(true);
    expect(await stored(listing.id)).toMatchObject({ outcome: "NO_BIDS", winnerId: null, finalPriceCents: null });
    expect((await stored(listing.id)).closedAt).toBeInstanceOf(Date);
    expect(closed).toEqual([{ type: "AuctionClosed", listingId: listing.id, outcome: "NO_BIDS", winnerId: null, finalPriceCents: null }]);
  });

  it("sells to the high bidder at the final bid when there is no reserve or the reserve is met", async () => {
    const plain = await withBid(2500);
    const met = await withBid(5000, { reservePriceCents: 5000 });
    await closer.close(plain.id);
    await closer.close(met.id);
    expect(await stored(plain.id)).toMatchObject({ outcome: "SOLD", winnerId: buyer.id, finalPriceCents: 2500 });
    expect(await stored(met.id)).toMatchObject({ outcome: "SOLD", winnerId: buyer.id, finalPriceCents: 5000 });
    expect(closed.map((e) => e.outcome)).toEqual(["SOLD", "SOLD"]);
  });

  it("makes no sale when the reserve was not met", async () => {
    const listing = await withBid(4999, { reservePriceCents: 5000 });
    await closer.close(listing.id);
    expect(await stored(listing.id)).toMatchObject({ outcome: "NO_SALE", winnerId: null, finalPriceCents: null });
    expect(closed[0]).toMatchObject({ outcome: "NO_SALE", winnerId: null });
  });

  it("leaves a live auction, an upcoming one and a draft alone", async () => {
    const live = await makeListing({ endsAt: new Date(Date.now() + DAY) });
    const upcoming = await makeListing({ startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 4 * DAY) });
    const draft = await makeListing({ status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    for (const l of [live, upcoming, draft]) expect(await closer.close(l.id)).toBe(false);
    for (const l of [live, upcoming, draft]) expect((await stored(l.id)).closedAt).toBeNull();
    expect(closed).toEqual([]);
  });

  it("closes once however many times it is asked, even all at the same moment", async () => {
    const listing = await withBid(3000);
    expect(await closer.close(listing.id)).toBe(true);
    const firstClosedAt = (await stored(listing.id)).closedAt;
    expect(await closer.close(listing.id)).toBe(false);

    const racing = await withBid(3000);
    const results = await Promise.all(Array.from({ length: 50 }, () => closer.close(racing.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(closed.filter((e) => e.listingId === racing.id)).toHaveLength(1);
    expect((await stored(listing.id)).closedAt).toEqual(firstClosedAt); // the second call changed nothing
  });

  it("does not close an auction that a late bid has just extended", async () => {
    const [bidder] = await makePeople(1);
    const listing = await makeListing({ startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 90 * SECOND) });
    await app.get(BidsService).placeBid(bidder.id, listing.id, { amountCents: 1000, idempotencyKey: randomUUID() }, null);
    expect((await stored(listing.id)).endsAt!.getTime()).toBeGreaterThan(Date.now() + 100 * SECOND);
    expect(await closer.close(listing.id)).toBe(false);
    expect((await stored(listing.id)).closedAt).toBeNull();
  });

  it("refuses a bid on a closed auction", async () => {
    const [bidder] = await makePeople(1);
    const listing = await withBid(1000);
    await closer.close(listing.id);
    const token = await new SignJWT({ email: "x@example.com", role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(bidder.id).setExpirationTime("10m").sign(authSecret());
    const res = await request(app.getHttpServer()).post(`/listings/${listing.id}/bids`).set("Authorization", `Bearer ${token}`).send({ amountCents: 5000, idempotencyKey: randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_LIVE");
  });

  it("sweeps up every ended, unclosed auction and nothing else", async () => {
    const a = await withBid(1000);
    const b = await makeListing();
    const live = await makeListing({ endsAt: new Date(Date.now() + DAY) });
    const already = await withBid(1000);
    await closer.close(already.id);
    closed = [];
    expect(await closer.sweep()).toBeGreaterThanOrEqual(2);
    expect((await stored(a.id)).outcome).toBe("SOLD");
    expect((await stored(b.id)).outcome).toBe("NO_BIDS");
    expect((await stored(live.id)).closedAt).toBeNull();
    expect(closed.filter((e) => e.listingId === already.id)).toEqual([]);
    expect(await closer.sweep()).toBe(0);
  });

  it("shows the result on the listing page data", async () => {
    const listing = await withBid(2500);
    const before = await request(app.getHttpServer()).get(`/listings/${listing.id}`).expect(200);
    expect(before.body).toMatchObject({ phase: "ended", outcome: null, winner: null, finalPriceCents: null });
    await closer.close(listing.id);
    const after = await request(app.getHttpServer()).get(`/listings/${listing.id}`).expect(200);
    expect(after.body).toMatchObject({ outcome: "SOLD", winner: { id: buyer.id, username: buyer.username }, finalPriceCents: 2500 });
    expect(after.body.closedAt).toBeTruthy();
  });
});

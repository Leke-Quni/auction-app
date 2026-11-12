import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

// Every amount in a response, whatever it is called: a hidden maximum must be in none of them. (Searching the text for the digits
// would match the random ids and times.)
const centsIn = (value: unknown): number[] =>
  Array.isArray(value) ? value.flatMap(centsIn)
  : value && typeof value === "object" ? Object.entries(value).flatMap(([key, v]) => (key.endsWith("Cents") && typeof v === "number" ? [v] : centsIn(v)))
  : [];

// Proxy bidding through the real API: the number a bidder types is a hidden maximum, and the system bids for them.
describe("proxy bidding", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let categoryId: string;
  let seller: Person;
  const api = () => request(app.getHttpServer());

  interface Person {
    id: string;
    username: string;
    token: string;
  }

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return { id: `pxy_${stamp}_${n}`, email: `pxy-${n}-${stamp}@example.com`, firstName: "Proxy", lastName: "Tester", username: `px${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(rows.map(async (row) => ({ id: row.id, username: row.username, token: await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret()) })));
  };

  const makeListing = (over: Record<string, unknown> = {}) =>
    prisma.listing.create({
      data: {
        sellerId: seller.id, title: "Proxy bid test listing", description: "A listing for the proxy bid tests.", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date(Date.now() - DAY), ...over,
      },
    });

  const bid = (person: Person, listingId: string, amountCents: number, key: string = randomUUID()) =>
    api().post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${person.token}`).send({ amountCents, idempotencyKey: key });
  const stored = (id: string) => prisma.listing.findUniqueOrThrow({ where: { id } });
  const rowsOf = async (listingId: string) =>
    (await prisma.bid.findMany({ where: { listingId }, orderBy: { seq: "asc" }, include: { bidder: { select: { username: true } } } })).map((r) => ({ who: r.bidder.username, kind: r.kind, amount: r.amountCents, max: r.maxCents, outcome: r.outcome }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SEARCH_INDEX).useValue(new NoopSearchIndex()).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "pxy-", endsWith: `-${stamp}@example.com` } };
    const listingIds = (await prisma.listing.findMany({ where: { seller: mine }, select: { id: true } })).map((l) => l.id);
    await prisma.order.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  it("works through the six examples: first bid, defence, takeover, tie and a hidden raise", async () => {
    const [a, b] = await makePeople(2);
    const listing = await makeListing();
    const name = { a: a.username, b: b.username };

    // 1. The first bid sets the starting price, whatever maximum was typed.
    const first = (await bid(a, listing.id, 5000).expect(201)).body;
    expect(first).toMatchObject({ outcome: "LEADING", yourMaxCents: 5000, previousHighBidderId: null, listing: { currentBidCents: 1000, bidCount: 1, highBidderId: a.id } });

    // 2. A challenger below the leader's maximum is beaten at once, one step above their own: a 201, not an error.
    const defended = (await bid(b, listing.id, 2000).expect(201)).body;
    expect(defended).toMatchObject({ outcome: "OUTBID_BY_PROXY", yourMaxCents: 2000, previousHighBidderId: null, listing: { currentBidCents: 2100, bidCount: 3, highBidderId: a.id, highBidder: { id: a.id } } });
    expect(defended.rows.map((r: { amountCents: number; bidder: { id: string } }) => [r.amountCents, r.bidder.id])).toEqual([[2000, b.id], [2100, a.id]]);
    // Nothing the challenger is sent reveals the leader's maximum.
    expect(centsIn(defended)).not.toContain(5000);

    // 3. A challenger above the leader's maximum takes the lead one step above it; the old leader is the one who was outbid.
    const takeover = (await bid(b, listing.id, 6000).expect(201)).body;
    expect(takeover).toMatchObject({ outcome: "LEADING", yourMaxCents: 6000, previousHighBidderId: a.id, listing: { currentBidCents: 5250, bidCount: 5, highBidderId: b.id } });
    expect(takeover.rows.map((r: { amountCents: number }) => r.amountCents)).toEqual([5000, 5250]);

    // 4. The same maximum ties: the earlier maximum wins, at that amount.
    const tie = (await bid(a, listing.id, 6000).expect(201)).body;
    expect(tie).toMatchObject({ outcome: "OUTBID_BY_PROXY", previousHighBidderId: null, listing: { currentBidCents: 6000, bidCount: 7, highBidderId: b.id } });

    // 5. The leader raising their own maximum changes nothing anyone can see.
    const raised = (await bid(b, listing.id, 8000).expect(201)).body;
    expect(raised).toMatchObject({ outcome: "MAX_RAISED", yourMaxCents: 8000, rows: [], listing: { currentBidCents: 6000, bidCount: 7, highBidderId: b.id } });

    expect(await rowsOf(listing.id)).toEqual([
      { who: name.a, kind: "BID", amount: 1000, max: 5000, outcome: "LEADING" },
      { who: name.b, kind: "BID", amount: 2000, max: 2000, outcome: "OUTBID_BY_PROXY" },
      { who: name.a, kind: "AUTO", amount: 2100, max: null, outcome: null },
      { who: name.a, kind: "AUTO", amount: 5000, max: null, outcome: null },
      { who: name.b, kind: "BID", amount: 5250, max: 6000, outcome: "LEADING" },
      { who: name.a, kind: "BID", amount: 6000, max: 6000, outcome: "OUTBID_BY_PROXY" },
      { who: name.b, kind: "AUTO", amount: 6000, max: null, outcome: null },
      { who: name.b, kind: "RAISE", amount: 6000, max: 8000, outcome: "MAX_RAISED" },
    ]);
    const held = new Map((await prisma.autoBid.findMany({ where: { listingId: listing.id } })).map((h) => [h.bidderId, h.maxCents]));
    expect([held.get(a.id), held.get(b.id)]).toEqual([6000, 8000]);
    // Strict order, even for rows made in one request.
    const seqs = (await prisma.bid.findMany({ where: { listingId: listing.id }, orderBy: { seq: "asc" }, select: { seq: true } })).map((r) => r.seq);
    expect(new Set(seqs).size).toBe(seqs.length);

    // The public history shows the price-setting rows only, newest first, and never the hidden raise.
    const history = (await api().get(`/listings/${listing.id}/bids?limit=5`).expect(200)).body;
    expect(history.total).toBe(7);
    expect(history.items.map((i: { amountCents: number; bidder: { username: string } }) => [i.amountCents, i.bidder.username])).toEqual([[6000, name.b], [6000, name.a], [5250, name.b], [5000, name.a], [2100, name.a]]);
    expect(centsIn(history)).not.toContain(8000);
    expect(centsIn(history.items)).toEqual(expect.arrayContaining([6000, 5250, 5000, 2100]));
  });

  it("refuses what the old rules refused, and a maximum that is not higher", async () => {
    const [a, b] = await makePeople(2);
    const listing = await makeListing();
    await bid(a, listing.id, 1000).expect(201);
    const low = await bid(b, listing.id, 1099).expect(422);
    expect(low.body).toMatchObject({ code: "TOO_LOW", minimumNextBidCents: 1100 });
    expect((await bid(a, listing.id, 1000).expect(409)).body.code).toBe("MAX_NOT_HIGHER");
    expect(await rowsOf(listing.id)).toHaveLength(1);
  });

  describe("retrying a request that made several rows", () => {
    it("answers a retry of each kind of request exactly as the first time, and adds nothing", async () => {
      const [a, b] = await makePeople(2);
      const listing = await makeListing();
      const keys = { first: randomUUID(), defended: randomUUID(), takeover: randomUUID(), raised: randomUUID() };
      await bid(a, listing.id, 5000, keys.first).expect(201);
      const defended = (await bid(b, listing.id, 2000, keys.defended).expect(201)).body;
      const takeover = (await bid(b, listing.id, 6000, keys.takeover).expect(201)).body;
      const raised = (await bid(b, listing.id, 8000, keys.raised).expect(201)).body;
      const before = await rowsOf(listing.id);
      const listingBefore = await stored(listing.id);

      const again = {
        first: (await bid(a, listing.id, 5000, keys.first).expect(200)).body,
        defended: (await bid(b, listing.id, 2000, keys.defended).expect(200)).body,
        takeover: (await bid(b, listing.id, 6000, keys.takeover).expect(200)).body,
        raised: (await bid(b, listing.id, 8000, keys.raised).expect(200)).body,
      };
      expect(again.defended).toMatchObject({ replayed: true, outcome: "OUTBID_BY_PROXY", yourMaxCents: 2000, rows: [], previousHighBidderId: null });
      expect(defended.bid.id).toBe(again.defended.bid.id);
      expect(again.takeover).toMatchObject({ replayed: true, outcome: "LEADING", yourMaxCents: 6000 });
      expect(again.raised).toMatchObject({ replayed: true, outcome: "MAX_RAISED", yourMaxCents: 8000 });
      expect(again.first).toMatchObject({ replayed: true, outcome: "LEADING", yourMaxCents: 5000 });
      expect(takeover.bid.id).toBe(again.takeover.bid.id);
      expect(raised.bid.id).toBe(again.raised.bid.id);
      expect(await rowsOf(listing.id)).toEqual(before);
      expect(await stored(listing.id)).toMatchObject({ currentBidCents: listingBefore.currentBidCents, bidCount: listingBefore.bidCount, highBidderId: listingBefore.highBidderId });
    });

    it("refuses a key that is reused for a different maximum, even though the saved price is not what was typed", async () => {
      const [a, b] = await makePeople(2);
      const listing = await makeListing();
      await bid(a, listing.id, 5000).expect(201);
      const key = randomUUID();
      await bid(b, listing.id, 2000, key).expect(201); // saved at €20.00 as it is, but a different typed amount is another bid
      expect((await bid(b, listing.id, 2100, key).expect(409)).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect((await bid(b, listing.id, 2000, key).expect(200)).body.replayed).toBe(true);
      // A key typed with a maximum above the saved price: the saved price is €10.00, the typed maximum €50.00.
      const high = randomUUID();
      const other = (await makePeople(1))[0];
      const second = await makeListing();
      await bid(other, second.id, 5000, high).expect(201);
      expect((await bid(other, second.id, 1000, high).expect(409)).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect((await bid(other, second.id, 5000, high).expect(200)).body.replayed).toBe(true);
    });

    it("saves one request and its rows when the same request arrives ten times at once", async () => {
      const [a, b] = await makePeople(2);
      const listing = await makeListing();
      await bid(a, listing.id, 5000).expect(201);
      const key = randomUUID();
      const responses = await Promise.all(Array.from({ length: 10 }, () => bid(b, listing.id, 2000, key)));
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 200)).toHaveLength(9);
      expect(await rowsOf(listing.id)).toHaveLength(3); // a's first bid, b's request, a's defence
      expect(await stored(listing.id)).toMatchObject({ currentBidCents: 2100, bidCount: 3, highBidderId: a.id });
    });
  });

  describe("the reserve", () => {
    it("takes a lone bidder whose maximum covers it up to the reserve, so the auction sells", async () => {
      const [a] = await makePeople(1);
      const listing = await makeListing({ reservePriceCents: 10_000 });
      const res = (await bid(a, listing.id, 15_000).expect(201)).body;
      expect(res).toMatchObject({ outcome: "LEADING", listing: { currentBidCents: 10_000, bidCount: 1 } });
      await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      await app.get(AuctionCloseService).close(listing.id);
      expect(await stored(listing.id)).toMatchObject({ outcome: "SOLD", winnerId: a.id, finalPriceCents: 10_000 });
    });

    it("leaves the price alone when the maximum does not cover it, and the auction ends without a sale", async () => {
      const [a] = await makePeople(1);
      const listing = await makeListing({ reservePriceCents: 10_000 });
      expect((await bid(a, listing.id, 9_000).expect(201)).body.listing.currentBidCents).toBe(1000);
      await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      await app.get(AuctionCloseService).close(listing.id);
      expect(await stored(listing.id)).toMatchObject({ outcome: "NO_SALE", winnerId: null });
    });

    it("raises the price to the reserve when a hidden raise brings the maximum up to it", async () => {
      const [a] = await makePeople(1);
      const listing = await makeListing({ reservePriceCents: 10_000 });
      await bid(a, listing.id, 5_000).expect(201);
      const res = (await bid(a, listing.id, 12_000).expect(201)).body;
      expect(res).toMatchObject({ outcome: "MAX_RAISED", listing: { currentBidCents: 10_000, bidCount: 2, highBidderId: a.id } });
      expect(res.rows).toHaveLength(1);
    });
  });

  describe("anti-sniping", () => {
    it("extends the auction for every change of price in the last two minutes, once per request, and never for a hidden raise", async () => {
      const [a, b] = await makePeople(2);
      const listing = await makeListing({ endsAt: new Date(Date.now() + 90_000) });
      const first = (await bid(a, listing.id, 5000).expect(201)).body;
      expect(first).toMatchObject({ extended: true, listing: { extensionCount: 1 } });

      // A challenger beaten at once still moved the price (two rows), so it extends, but only once.
      const defended = (await bid(b, listing.id, 2000).expect(201)).body;
      expect(defended).toMatchObject({ outcome: "OUTBID_BY_PROXY", extended: true, listing: { extensionCount: 2 } });
      expect(defended.rows).toHaveLength(2);

      // A hidden raise changes no price: the end and the count stay where they are.
      const endsBefore = (await stored(listing.id)).endsAt!.getTime();
      const raised = (await bid(a, listing.id, 9000).expect(201)).body;
      expect(raised).toMatchObject({ outcome: "MAX_RAISED", extended: false, listing: { extensionCount: 2 } });
      expect((await stored(listing.id)).endsAt!.getTime()).toBe(endsBefore);
      expect((await stored(listing.id)).extensionCount).toBe(2);
    });

    it("does not extend for a bid earlier than the last two minutes, defended or not", async () => {
      const [a, b] = await makePeople(2);
      const listing = await makeListing();
      await bid(a, listing.id, 5000).expect(201);
      expect((await bid(b, listing.id, 2000).expect(201)).body).toMatchObject({ outcome: "OUTBID_BY_PROXY", extended: false });
      expect((await stored(listing.id)).extensionCount).toBe(0);
    });
  });
});

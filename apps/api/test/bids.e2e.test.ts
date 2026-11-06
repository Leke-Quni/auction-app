import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { minimumNextBidCents } from "@auction/shared";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const MINUTE = 60_000;
let counter = 0;

describe("bids", () => {
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
      return {
        id: `bidtest_${stamp}_${n}`,
        email: `bid-${n}-${stamp}@example.com`,
        firstName: "Bid",
        lastName: "Tester",
        username: `bt${n}x${stamp}`,
        passwordHash: "!test",
        emailVerified: new Date(),
      };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        username: row.username,
        token: await new SignJWT({ email: row.email, role: "USER" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(row.id)
          .setExpirationTime("10m")
          .sign(authSecret()),
      })),
    );
  };

  const makeListing = (over: Record<string, unknown> = {}) =>
    prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Bid test listing",
        description: "A listing for the bid tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 2 * DAY),
        publishedAt: new Date(Date.now() - DAY),
        ...over,
      },
    });

  const bid = (person: Person, listingId: string, amountCents: number, key: string = randomUUID()) =>
    api().post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${person.token}`).send({ amountCents, idempotencyKey: key });

  const stored = (id: string) => prisma.listing.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    // Bids and listings first: a listing or an account that has bids cannot be deleted.
    const mine = { email: { startsWith: "bid-", endsWith: `-${stamp}@example.com` } };
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  describe("who may bid, and when", () => {
    it("requires sign-in", async () => {
      const listing = await makeListing();
      await api().post(`/listings/${listing.id}/bids`).send({ amountCents: 1000, idempotencyKey: randomUUID() }).expect(401);
    });

    it("rejects a malformed bid with a 400", async () => {
      const [person] = await makePeople(1);
      const listing = await makeListing();
      const post = (body: object) => api().post(`/listings/${listing.id}/bids`).set("Authorization", `Bearer ${person.token}`).send(body);
      await post({ amountCents: "ten euros", idempotencyKey: randomUUID() }).expect(400);
      await post({ amountCents: 10.5, idempotencyKey: randomUUID() }).expect(400);
      await post({ amountCents: 1000 }).expect(400);
      await post({ amountCents: 1000, idempotencyKey: "short" }).expect(400);
    });

    it("says 404 for a listing that does not exist or is still a draft", async () => {
      const [person] = await makePeople(1);
      const draft = await makeListing({ status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
      await bid(person, "no-such-listing", 1000).expect(404);
      await bid(person, draft.id, 1000).expect(404);
    });

    it("keeps a seller from bidding on their own listing", async () => {
      const listing = await makeListing();
      const res = await bid(seller, listing.id, 1000).expect(403);
      expect(res.body.code).toBe("OWN_LISTING");
      expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(0);
    });

    it("takes bids only while the auction is live", async () => {
      const [person] = await makePeople(1);
      const upcoming = await makeListing({ startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 4 * DAY) });
      const ended = await makeListing({ startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - DAY) });
      for (const listing of [upcoming, ended]) {
        const res = await bid(person, listing.id, 1000).expect(409);
        expect(res.body.code).toBe("NOT_LIVE");
      }
    });

    it("does not let the high bidder outbid themselves", async () => {
      const [person] = await makePeople(1);
      const listing = await makeListing();
      await bid(person, listing.id, 1000).expect(201);
      const res = await bid(person, listing.id, 5000).expect(409);
      expect(res.body.code).toBe("ALREADY_HIGHEST");
      expect((await stored(listing.id)).currentBidCents).toBe(1000);
    });
  });

  describe("the minimum", () => {
    it("needs only the starting price for the first bid, and says what the minimum is when it is missed", async () => {
      const [person] = await makePeople(1);
      const listing = await makeListing({ startingPriceCents: 2500 });
      const low = await bid(person, listing.id, 2499).expect(422);
      expect(low.body).toMatchObject({ code: "TOO_LOW", minimumNextBidCents: 2500 });
      const ok = await bid(person, listing.id, 2500).expect(201);
      expect(ok.body.listing).toMatchObject({ currentBidCents: 2500, bidCount: 1, minimumNextBidCents: minimumNextBidCents({ startingPriceCents: 2500, currentBidCents: 2500 }) });
    });

    it("follows the rule: current + the larger of €1 and 5%", async () => {
      const [a, b, c] = await makePeople(3);
      const listing = await makeListing({ startingPriceCents: 10_000 });
      await bid(a, listing.id, 10_000).expect(201);
      expect((await bid(b, listing.id, 10_499).expect(422)).body.minimumNextBidCents).toBe(10_500);
      await bid(b, listing.id, 10_500).expect(201);
      expect((await bid(c, listing.id, 11_024).expect(422)).body.minimumNextBidCents).toBe(11_025);
      await bid(c, listing.id, 20_000).expect(201);
      expect(await stored(listing.id)).toMatchObject({ currentBidCents: 20_000, bidCount: 3, highBidderId: c.id });
    });

    it("shows the current bid, bid count, minimum next bid and high bidder on the listing", async () => {
      const [person] = await makePeople(1);
      const listing = await makeListing();
      const before = (await api().get(`/listings/${listing.id}`).expect(200)).body;
      expect(before).toMatchObject({ currentBidCents: null, bidCount: 0, minimumNextBidCents: 1000, highBidder: null });
      expect(Math.abs(new Date(before.serverTime).getTime() - Date.now())).toBeLessThan(5_000);
      await bid(person, listing.id, 1200).expect(201);
      const after = (await api().get(`/listings/${listing.id}`).expect(200)).body;
      expect(after).toMatchObject({ currentBidCents: 1200, bidCount: 1, minimumNextBidCents: 1300, highBidder: { id: person.id, username: person.username } });
    });
  });

  describe("retrying a bid", () => {
    it("places it once: the same key again answers 200 with the same bid, even after being outbid", async () => {
      const [a, b] = await makePeople(2);
      const listing = await makeListing();
      const key = randomUUID();
      const first = await bid(a, listing.id, 1000, key).expect(201);
      await bid(b, listing.id, 1100).expect(201);
      const again = await bid(a, listing.id, 1000, key).expect(200);
      expect(again.body.replayed).toBe(true);
      expect(again.body.bid.id).toBe(first.body.bid.id);
      expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(2);
    });

    it("refuses a key that was used for a different amount or a different listing", async () => {
      const [a] = await makePeople(1);
      const one = await makeListing();
      const two = await makeListing();
      const key = randomUUID();
      await bid(a, one.id, 1000, key).expect(201);
      expect((await bid(a, one.id, 1500, key).expect(409)).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect((await bid(a, two.id, 1000, key).expect(409)).body.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await prisma.bid.count({ where: { bidderId: a.id } })).toBe(1);
    });

    it("keeps one person's keys apart from another's", async () => {
      const [a, b] = await makePeople(2);
      const listing = await makeListing();
      const key = randomUUID();
      await bid(a, listing.id, 1000, key).expect(201);
      await bid(b, listing.id, 1100, key).expect(201);
    });
  });

  describe("anti-sniping", () => {
    const near = (ms: number) => ({ endsAt: new Date(Date.now() + ms) });
    const within = (actual: Date, expectedMs: number) => Math.abs(actual.getTime() - (Date.now() + expectedMs)) < 5_000;

    it("a bid in the last 2 minutes moves the end to 2 minutes from now", async () => {
      const [person] = await makePeople(1);
      const listing = await makeListing(near(90_000));
      const res = await bid(person, listing.id, 1000).expect(201);
      expect(res.body.extended).toBe(true);
      expect(res.body.listing.extensionCount).toBe(1);
      expect(res.body.listing.finalChance).toBe(false);
      const row = await stored(listing.id);
      expect(row.extensionCount).toBe(1);
      expect(within(row.endsAt!, 2 * MINUTE)).toBe(true);
    });

    it("keeps extending on every late bid, counting each one", async () => {
      const people = await makePeople(5);
      const listing = await makeListing(near(100_000));
      for (const [i, person] of people.entries()) {
        await prisma.listing.update({ where: { id: listing.id }, data: near(60_000) });
        const res = await bid(person, listing.id, 1000 + i * 200).expect(201);
        expect(res.body.extended, `bid ${i}`).toBe(true);
      }
      const row = await stored(listing.id);
      expect(row.extensionCount).toBe(5);
      expect(within(row.endsAt!, 2 * MINUTE)).toBe(true);
    });

    it("leaves the end alone for a bid earlier than the last 2 minutes", async () => {
      const [a, b] = await makePeople(2);
      for (const [person, ms] of [[a, 2 * DAY], [b, 3 * MINUTE]] as const) {
        const listing = await makeListing(near(ms));
        const before = (await stored(listing.id)).endsAt!.getTime();
        const res = await bid(person, listing.id, 1000).expect(201);
        expect(res.body.extended, String(ms)).toBe(false);
        const row = await stored(listing.id);
        expect(row.endsAt!.getTime()).toBe(before);
        expect(row.extensionCount).toBe(0);
      }
    });

    it("stops at 24 hours past the original end, and says it is the final chance", async () => {
      const [a, b, c] = await makePeople(3);
      // A 1-day auction already extended for almost a day: the ceiling (start + 1 day + 24 hours) is 30 seconds away.
      const ceiling = Date.now() + 30_000;
      const listing = await makeListing({ durationDays: 1, startsAt: new Date(ceiling - 2 * DAY), endsAt: new Date(Date.now() + 20_000) });
      const res = await bid(a, listing.id, 1000).expect(201);
      expect(res.body.extended).toBe(true);
      expect(res.body.listing.finalChance).toBe(true);
      expect((await stored(listing.id)).endsAt!.getTime()).toBe(ceiling);

      // At the ceiling the end never moves again, however late the bid.
      const later = await bid(b, listing.id, 1100).expect(201);
      expect(later.body.extended).toBe(false);
      expect(later.body.listing.finalChance).toBe(true);
      expect((await stored(listing.id)).endsAt!.getTime()).toBe(ceiling);
      await bid(c, listing.id, 1300).expect(201);
      expect((await stored(listing.id)).extensionCount).toBe(1);
    });
  });

  describe("history", () => {
    it("lists the bids, highest first, with who placed them", async () => {
      const [a, b, c] = await makePeople(3);
      const listing = await makeListing();
      await bid(a, listing.id, 1000).expect(201);
      await bid(b, listing.id, 1100).expect(201);
      await bid(c, listing.id, 1300).expect(201);
      const res = await api().get(`/listings/${listing.id}/bids`).expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items.map((i: { amountCents: number; bidder: { username: string } }) => [i.amountCents, i.bidder.username])).toEqual([
        [1300, c.username],
        [1100, b.username],
        [1000, a.username],
      ]);
      expect((await api().get(`/listings/${listing.id}/bids?limit=2`).expect(200)).body.items).toHaveLength(2);
      await api().get(`/listings/${listing.id}/bids?limit=0`).expect(400);
    });

    it("is empty for a listing without bids, and 404 for a draft or a missing listing", async () => {
      const listing = await makeListing();
      const draft = await makeListing({ status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
      expect((await api().get(`/listings/${listing.id}/bids`).expect(200)).body).toEqual({ items: [], total: 0 });
      await api().get(`/listings/${draft.id}/bids`).expect(404);
      await api().get("/listings/no-such-listing/bids").expect(404);
    });
  });

  describe("removing a listing", () => {
    it("is refused once it has a bid", async () => {
      const [person] = await makePeople(1);
      const listing = await makeListing();
      await bid(person, listing.id, 1000).expect(201);
      const res = await api().delete(`/listings/${listing.id}`).set("Authorization", `Bearer ${seller.token}`).expect(409);
      expect(res.body.message).toMatch(/has bids/);
      expect(await prisma.listing.count({ where: { id: listing.id } })).toBe(1);
    });
  });

  describe("simultaneous bids", () => {
    it("50 bids for the same amount at the same moment: exactly one wins and the rest are refused", async () => {
      const bidders = await makePeople(50);
      const listing = await makeListing();
      const responses = await Promise.all(bidders.map((person) => bid(person, listing.id, 1000)));
      const statuses = responses.map((res) => res.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 422)).toHaveLength(49);

      const winnerIndex = statuses.indexOf(201);
      const row = await stored(listing.id);
      expect(row).toMatchObject({ bidCount: 1, currentBidCents: 1000, highBidderId: bidders[winnerIndex].id });
      expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(1);
    }, 30_000);

    it("50 different amounts at the same moment: every accepted bid cleared the minimum, and the books balance", async () => {
      const bidders = await makePeople(50);
      const listing = await makeListing();
      const amounts = bidders.map((_, i) => 1000 + i * 20);
      const responses = await Promise.all(bidders.map((person, i) => bid(person, listing.id, amounts[i])));

      const statuses = responses.map((res) => res.status);
      expect(statuses.every((status) => status === 201 || status === 422)).toBe(true);
      const accepted = statuses.filter((status) => status === 201).length;
      expect(accepted).toBeGreaterThanOrEqual(1);

      const rows = await prisma.bid.findMany({ where: { listingId: listing.id }, orderBy: { amountCents: "asc" } });
      expect(rows).toHaveLength(accepted);
      expect(rows[0].amountCents).toBeGreaterThanOrEqual(1000);
      for (let i = 1; i < rows.length; i++) {
        const minimum = minimumNextBidCents({ startingPriceCents: 1000, currentBidCents: rows[i - 1].amountCents });
        expect(rows[i].amountCents, `bid ${i}`).toBeGreaterThanOrEqual(minimum);
      }
      const top = rows[rows.length - 1];
      expect(await stored(listing.id)).toMatchObject({ bidCount: accepted, currentBidCents: top.amountCents, highBidderId: top.bidderId });
    }, 30_000);

    it("other requests still get through while 50 bidders queue on one auction", async () => {
      const bidders = await makePeople(50);
      const hot = await makeListing();
      const other = await makeListing();
      const burst = Promise.all(bidders.map((person, i) => bid(person, hot.id, 1000 + i * 20)));
      const started = Date.now();
      const reads = await Promise.all(Array.from({ length: 10 }, () => api().get(`/listings/${other.id}`).expect(200)));
      expect(reads).toHaveLength(10);
      expect(Date.now() - started).toBeLessThan(5000);
      await burst;
    }, 30_000);

    it("one person's request sent 10 times at the same moment places one bid", async () => {
      const [person] = await makePeople(1);
      const listing = await makeListing();
      const key = randomUUID();
      const responses = await Promise.all(Array.from({ length: 10 }, () => bid(person, listing.id, 1000, key)));
      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
      expect(new Set(responses.map((res) => res.body.bid.id)).size).toBe(1);
      expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(1);
      expect((await stored(listing.id)).bidCount).toBe(1);
    }, 30_000);
  });
});

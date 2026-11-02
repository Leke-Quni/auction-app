import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { VIEWER_IP_HEADER, VIEWER_IP_SIGNATURE_HEADER } from "@auction/shared";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { signViewerIp } from "../src/common/client-ip";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

interface Person {
  id: string;
  token: string;
}

describe("bid rate limits and audit log", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let categoryId: string;
  let seller: Person;
  const ids: string[] = [];
  const saved = { user: process.env.BID_LIMIT_USER, ip: process.env.BID_LIMIT_IP };
  const api = () => request(app.getHttpServer());

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return {
        id: `bp_${stamp}_${n}`,
        email: `bp-${n}-${stamp}@example.com`,
        firstName: "Bid",
        lastName: "Protect",
        username: `bp${n}x${stamp}`,
        passwordHash: "!test",
        emailVerified: new Date(),
      };
    });
    await prisma.user.createMany({ data: rows });
    ids.push(...rows.map((r) => r.id));
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        token: await new SignJWT({ email: row.email, role: "USER" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(row.id)
          .setExpirationTime("10m")
          .sign(authSecret()),
      })),
    );
  };

  const makeListing = () =>
    prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Protection test listing",
        description: "A listing for the rate limit tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 2 * DAY),
        publishedAt: new Date(Date.now() - DAY),
      },
    });

  const bid = (person: Person, listingId: string, amountCents: number, opts: { key?: string; ip?: string; signature?: string } = {}) => {
    const req = api().post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${person.token}`);
    if (opts.ip) req.set(VIEWER_IP_HEADER, opts.ip).set(VIEWER_IP_SIGNATURE_HEADER, opts.signature ?? signViewerIp(opts.ip));
    return req.send({ amountCents, idempotencyKey: opts.key ?? randomUUID() });
  };
  const audit = (userId: string) => prisma.bidAudit.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

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
    process.env.BID_LIMIT_USER = saved.user;
    process.env.BID_LIMIT_IP = saved.ip;
    await prisma.bidAudit.deleteMany({ where: { userId: { in: ids } } });
    const mine = { email: { startsWith: "bp-", endsWith: `-${stamp}@example.com` } };
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  describe("audit log", () => {
    it("records every attempt: accepted, retried, and refused with the reason", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const key = randomUUID();
      await bid(anna, listing.id, 1000, { key, ip: "203.0.113.50" }).expect(201);
      await bid(anna, listing.id, 1000, { key, ip: "203.0.113.50" }).expect(200); // replay
      await bid(anna, listing.id, 1100, { ip: "203.0.113.50" }).expect(409); // already highest
      await bid(ben, listing.id, 1050, { ip: "203.0.113.51" }).expect(422); // too low
      await bid(seller, listing.id, 1200).expect(403); // own listing

      expect((await audit(anna.id)).map((r) => [r.outcome, r.reason, r.amountCents, r.ip, r.listingId])).toEqual([
        ["ACCEPTED", null, 1000, "203.0.113.50", listing.id],
        ["ACCEPTED", "REPLAY", 1000, "203.0.113.50", listing.id],
        ["REFUSED", "ALREADY_HIGHEST", 1100, "203.0.113.50", listing.id],
      ]);
      expect((await audit(ben.id)).map((r) => [r.outcome, r.reason, r.amountCents])).toEqual([["REFUSED", "TOO_LOW", 1050]]);
      expect((await audit(seller.id)).map((r) => [r.outcome, r.reason])).toEqual([["REFUSED", "OWN_LISTING"]]);
      expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(1);
    });

    it("stores the signed address on the bid too, and ignores an address with a bad signature", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000, { ip: "203.0.113.60" }).expect(201);
      await bid(ben, listing.id, 1200, { ip: "6.6.6.6", signature: "forged" }).expect(201);
      const rows = await prisma.bid.findMany({ where: { listingId: listing.id }, orderBy: { amountCents: "asc" } });
      expect(rows[0].ip).toBe("203.0.113.60");
      expect(rows[1].ip).not.toBe("6.6.6.6");
      expect((await audit(ben.id))[0].ip).toBe(rows[1].ip);
    });

    it("does not record a malformed request, which never reaches the bid", async () => {
      const [anna] = await makePeople(1);
      const listing = await makeListing();
      await api().post(`/listings/${listing.id}/bids`).set("Authorization", `Bearer ${anna.token}`).send({ amountCents: "x" }).expect(400);
      expect(await audit(anna.id)).toHaveLength(0);
    });
  });

  describe("rate limits", () => {
    it("limits one user's attempts per minute, counting refused ones, and records the refusal", async () => {
      process.env.BID_LIMIT_USER = "3";
      process.env.BID_LIMIT_IP = "100000";
      try {
        const [anna, ben] = await makePeople(2);
        const listing = await makeListing();
        for (let i = 0; i < 3; i++) await bid(anna, listing.id, 1).expect(422); // too low, but each one counts
        const res = await bid(anna, listing.id, 1000).expect(429);
        expect(res.body.code).toBe("RATE_LIMITED");
        expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(0);
        expect((await audit(anna.id)).at(-1)).toMatchObject({ outcome: "REFUSED", reason: "RATE_LIMITED", amountCents: 1000 });

        await bid(ben, listing.id, 1000).expect(201); // another user is not affected
      } finally {
        process.env.BID_LIMIT_USER = saved.user;
        process.env.BID_LIMIT_IP = saved.ip;
      }
    });

    it("still answers a retry of a bid that went through when the user is over the limit", async () => {
      process.env.BID_LIMIT_USER = "2";
      process.env.BID_LIMIT_IP = "100000";
      try {
        const [anna] = await makePeople(1);
        const listing = await makeListing();
        const key = randomUUID();
        await bid(anna, listing.id, 1000, { key }).expect(201);
        await bid(anna, listing.id, 1100).expect(409); // refused (she already leads), but it counts
        await bid(anna, listing.id, 1100).expect(429); // over the limit now
        const retry = await bid(anna, listing.id, 1000, { key }).expect(200);
        expect(retry.body.replayed).toBe(true);
        expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(1);
      } finally {
        process.env.BID_LIMIT_USER = saved.user;
        process.env.BID_LIMIT_IP = saved.ip;
      }
    });

    it("writes one audit row a minute for a flood that is being limited, not one per request", async () => {
      process.env.BID_LIMIT_USER = "1";
      process.env.BID_LIMIT_IP = "100000";
      try {
        const [anna] = await makePeople(1);
        const listing = await makeListing();
        await bid(anna, listing.id, 1).expect(422);
        for (let i = 0; i < 5; i++) await bid(anna, listing.id, 1).expect(429);
        const limited = (await audit(anna.id)).filter((row) => row.reason === "RATE_LIMITED");
        expect(limited).toHaveLength(1);
      } finally {
        process.env.BID_LIMIT_USER = saved.user;
        process.env.BID_LIMIT_IP = saved.ip;
      }
    });

    it("limits one address across different users, and not another address", async () => {
      process.env.BID_LIMIT_USER = "100000";
      process.env.BID_LIMIT_IP = "2";
      try {
        const [anna, ben, cara, dana] = await makePeople(4);
        const listing = await makeListing();
        const ip = `203.0.113.${stamp % 200}-${randomUUID().slice(0, 8)}`;
        await bid(anna, listing.id, 1000, { ip }).expect(201);
        await bid(ben, listing.id, 1100, { ip }).expect(201);
        const res = await bid(cara, listing.id, 1300, { ip }).expect(429);
        expect(res.body.code).toBe("RATE_LIMITED");
        await bid(dana, listing.id, 1300, { ip: `other-${randomUUID().slice(0, 8)}` }).expect(201);
      } finally {
        process.env.BID_LIMIT_USER = saved.user;
        process.env.BID_LIMIT_IP = saved.ip;
      }
    });
  });
});

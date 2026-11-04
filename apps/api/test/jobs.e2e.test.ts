import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { AuctionEvents } from "../src/bids/auction-events";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { JOB_SCHEDULER } from "../src/jobs/job-scheduler";
import { FakePaymentProvider } from "../src/payments/fake-payment-provider";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const CURRENT = "test-current-signing-key";
const NEXT = "test-next-signing-key";
const CALLBACK = "https://api.example.test";
let counter = 0;

const envKeys = ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY", "API_PUBLIC_URL"] as const;

// What QStash sends: a JWT signed with a signing key, naming the address it called and the hash of the body.
const sign = (path: string, body = "{}", key = CURRENT, subject = `${CALLBACK}${path}`) =>
  new SignJWT({ body: createHash("sha256").update(body).digest("base64url") })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("Upstash")
    .setSubject(subject)
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 5)
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(key));

describe("scheduled jobs", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  const saved: Record<string, string | undefined> = {};
  const created: string[] = [];
  const closes: { id: string; at: Date }[] = [];
  const expiries: { id: string; at: Date }[] = [];
  let seller: string;
  let buyer: string;
  let categoryId: string;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    for (const k of envKeys) saved[k] = process.env[k];
    process.env.QSTASH_TOKEN = "test-token";
    process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT;
    process.env.QSTASH_NEXT_SIGNING_KEY = NEXT;
    process.env.API_PUBLIC_URL = CALLBACK;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX).useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER).useValue({ send: async () => undefined })
      .overrideProvider(PAYMENT_PROVIDER).useValue(new FakePaymentProvider())
      .overrideProvider(JOB_SCHEDULER)
      .useValue({
        scheduleClose: async (id: string, at: Date) => void closes.push({ id, at }),
        scheduleOrderExpiry: async (id: string, at: Date) => void expiries.push({ id, at }),
      })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    const users = ["s", "b"].map((t) => ({ id: `jb_${stamp}_${t}`, email: `jb-${t}-${stamp}@example.com`, firstName: "J", lastName: "B", username: `jb${t}${stamp}`, passwordHash: "!test", emailVerified: new Date() }));
    await prisma.user.createMany({ data: users });
    [seller, buyer] = users.map((u) => u.id) as [string, string];
  });

  afterAll(async () => {
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bidAudit.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listingId: { in: created } } });
    await prisma.listing.deleteMany({ where: { id: { in: created } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.com`, startsWith: "jb-" } } });
    await app.close();
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    closes.length = 0;
    expiries.length = 0;
  });

  // An auction with one bid. `ended` decides whether its end time has passed. The sweep might close it first, so these
  // tests use end times that are in the future until the test moves them.
  const auction = async (endsAt: Date) => {
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller, title: `Job lamp ${++counter}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED",
        startsAt: new Date(Date.now() - 4 * DAY), endsAt, publishedAt: new Date(Date.now() - 4 * DAY), currentBidCents: 1500, bidCount: 1, highBidderId: buyer,
        pickupAddress: { name: "Sam", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344000111" },
      },
    });
    created.push(listing.id);
    await prisma.bid.create({ data: { listingId: listing.id, bidderId: buyer, amountCents: 1500, idempotencyKey: randomUUID() } });
    return listing;
  };
  const end = (id: string) => prisma.listing.update({ where: { id }, data: { endsAt: new Date(Date.now() - 1000) } });
  const call = async (path: string, signature?: string, body = "{}") => {
    const req = api().post(path).set("Content-Type", "application/json");
    if (signature) req.set("Upstash-Signature", signature);
    return req.send(body);
  };

  describe("who may call them", () => {
    it("rejects a call with no signature, a wrong key, a different address or a different body", async () => {
      const l = await auction(new Date(Date.now() + DAY));
      const path = `/jobs/close/${l.id}`;
      await call(path).then((r) => expect(r.status).toBe(401));
      await call(path, await sign(path, "{}", "some-other-key")).then((r) => expect(r.status).toBe(401));
      await call(path, await sign(path, "{}", CURRENT, `${CALLBACK}/jobs/close/another`)).then((r) => expect(r.status).toBe(401));
      await call(path, await sign(path, '{"a":1}')).then((r) => expect(r.status).toBe(401));
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).closedAt).toBeNull();
    });

    it("accepts a call signed with either the current or the next key", async () => {
      const l = await auction(new Date(Date.now() + DAY));
      const path = `/jobs/close/${l.id}`;
      await call(path, await sign(path)).then((r) => expect(r.status).toBe(200));
      await call(path, await sign(path, "{}", NEXT)).then((r) => expect(r.status).toBe(200));
    });
  });

  describe("closing an auction", () => {
    it("closes an ended auction once, creates its order and schedules the payment deadline", async () => {
      const l = await auction(new Date(Date.now() + DAY));
      await end(l.id);
      const path = `/jobs/close/${l.id}`;
      const first = await call(path, await sign(path));
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ closed: true });
      const order = await prisma.order.findFirstOrThrow({ where: { listingId: l.id } });
      expect(expiries).toEqual([{ id: order.id, at: order.payBy }]);
      // QStash delivers a message twice: nothing changes the second time
      const second = await call(path, await sign(path));
      expect(second.body).toEqual({ closed: false });
      expect(await prisma.order.count({ where: { listingId: l.id } })).toBe(1);
      expect(expiries).toHaveLength(1);
    });

    it("leaves an auction that is not over yet open, and asks for the next call at its end time", async () => {
      const endsAt = new Date(Date.now() + 2 * DAY);
      const l = await auction(endsAt);
      const path = `/jobs/close/${l.id}`;
      const res = await call(path, await sign(path));
      expect(res.body).toEqual({ closed: false });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).closedAt).toBeNull();
      expect(closes).toEqual([{ id: l.id, at: endsAt }]); // the stale or early message passes the baton
    });

    it("answers 200 for an auction that does not exist, so QStash does not retry it for ever", async () => {
      const path = "/jobs/close/no-such-listing";
      const res = await call(path, await sign(path));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ closed: false });
    });

    it("is asked again for the new end time when a bid extends the auction", async () => {
      const l = await auction(new Date(Date.now() + 100_000));
      const newEnd = new Date(Date.now() + 220_000);
      app.get(AuctionEvents).publish({ type: "AuctionExtended", listingId: l.id, endsAt: newEnd, extensionCount: 1 });
      expect(closes).toEqual([{ id: l.id, at: newEnd }]);
    });
  });

  describe("giving up on an unpaid order", () => {
    const soldOrder = async () => {
      const l = await auction(new Date(Date.now() + DAY));
      await end(l.id);
      await closer.close(l.id);
      expiries.length = 0;
      return prisma.order.findFirstOrThrow({ where: { listingId: l.id } });
    };

    it("expires an order past its deadline, with a strike, and is safe to call twice", async () => {
      const order = await soldOrder();
      await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() - 1000) } });
      const path = `/jobs/expire-order/${order.id}`;
      const first = await call(path, await sign(path));
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ expired: true });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("EXPIRED");
      expect(await prisma.strike.count({ where: { orderId: order.id } })).toBe(1);
      const second = await call(path, await sign(path));
      expect(second.body).toEqual({ expired: false });
      expect(await prisma.strike.count({ where: { orderId: order.id } })).toBe(1);
    });

    it("leaves an order that is not due, and asks for the next call at its deadline", async () => {
      const order = await soldOrder();
      const path = `/jobs/expire-order/${order.id}`;
      const res = await call(path, await sign(path));
      expect(res.body).toEqual({ expired: false });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("AWAITING_PAYMENT");
      expect(expiries).toEqual([{ id: order.id, at: order.payBy }]);
    });
  });
});

import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { FakePaymentProvider } from "../src/payments/fake-payment-provider";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

interface Person {
  id: string;
  email: string;
  username: string;
  token: string;
}

describe("ratings and seller profiles", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let categoryId: string;
  const created: string[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];
  const mail: MailSender = { send: async (to, subject, text) => void sent.push({ to, subject, text }) };
  const api = () => request(app.getHttpServer());
  const as = (p: Person) => ({ Authorization: `Bearer ${p.token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(new FakePaymentProvider())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "rat-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.rating.deleteMany({ where: { order: { listingId: { in: created } } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePerson = async (): Promise<Person> => {
    const n = ++counter;
    const row = { id: `rat_${stamp}_${n}`, email: `rat-${n}-${stamp}@example.com`, firstName: "Rat", lastName: "Tester", username: `ra${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    await prisma.user.create({ data: row });
    return { id: row.id, email: row.email, username: row.username, token: await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret()) };
  };

  const address = { name: "Ada Buyer", line1: "Rr. Nene Tereza 1", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344111222" };
  const option = { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 };

  // A sold, closed and paid order with its delivery chosen.
  const order_ref = () => `s${counter}${stamp}`;
  const DELIVERY_DAYS_AGO = (days: number) => ({ shipmentStatus: "DELIVERED" as const, trackingCode: "FAKE1", shippedAt: new Date(Date.now() - (days + 1) * DAY), inTransitAt: new Date(Date.now() - (days + 1) * DAY), deliveredAt: new Date(Date.now() - days * DAY) });
  const paidOrder = async (buyer: Person, seller: Person, delivered: Record<string, unknown> = DELIVERY_DAYS_AGO(4)) => {
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: `Rating test ${counter}`,
        description: "A listing for the shipment tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - 4 * DAY),
        endsAt: new Date(Date.now() - 1000),
        publishedAt: new Date(Date.now() - 4 * DAY),
        currentBidCents: 3150,
        bidCount: 1,
        highBidderId: buyer.id,
      },
    });
    created.push(listing.id);
    await prisma.bid.create({ data: { listingId: listing.id, bidderId: buyer.id, amountCents: 3150, idempotencyKey: `k-${listing.id}` } });
    await closer.close(listing.id);
    const found = await prisma.order.findFirstOrThrow({ where: { listingId: listing.id } });
    return prisma.order.update({
      where: { id: found.id },
      data: { status: "PAID", paidAt: new Date(), invoiceNumber: `INV-TEST-${found.id}`, shippingAddress: address, shippingOption: option, shippingCents: 300, totalCents: 3450, trackingEmails: false, paymentRef: `fake_${order_ref()}`, ...delivered },
    });
  };

  const rate = (p: Person, orderId: string, body: unknown) => api().post(`/orders/${orderId}/rating`).set(as(p)).send(body as object);

  it("lets the buyer rate the seller once the parcel is delivered, and shows the rating to both sides", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    const res = await rate(buyer, order.id, { stars: 5, comment: "  Fast and well packed.  " }).expect(201);
    expect(res.body.rating).toMatchObject({ stars: 5, comment: "Fast and well packed." });
    for (const p of [buyer, seller]) {
      expect((await api().get(`/orders/${order.id}`).set(as(p)).expect(200)).body.rating).toMatchObject({ stars: 5, comment: "Fast and well packed." });
    }
    expect((await prisma.rating.findUniqueOrThrow({ where: { orderId: order.id } })).sellerId).toBe(seller.id);
  });

  it("accepts a rating with no comment", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    expect((await rate(buyer, order.id, { stars: 3, comment: "   " }).expect(201)).body.rating).toMatchObject({ stars: 3, comment: null });
  });

  it("refuses a second rating, however it arrives, and a rating before delivery or from anyone but the buyer", async () => {
    const [seller, buyer, stranger] = [await makePerson(), await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    const results = await Promise.all(Array.from({ length: 5 }, () => rate(buyer, order.id, { stars: 4 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.code === "ALREADY_RATED")).toHaveLength(4);
    expect(await prisma.rating.count({ where: { orderId: order.id } })).toBe(1);
    expect((await rate(seller, order.id, { stars: 5 }).expect(403)).body.code).toBe("NOT_BUYER");
    await rate(stranger, order.id, { stars: 5 }).expect(404);
    await api().post(`/orders/${order.id}/rating`).send({ stars: 5 }).expect(401);

    const shipped = await paidOrder(buyer, seller, { shipmentStatus: "IN_TRANSIT", trackingCode: "F", shippedAt: new Date(Date.now() - DAY), inTransitAt: new Date(), deliveredAt: null });
    expect((await rate(buyer, shipped.id, { stars: 5 }).expect(409)).body.code).toBe("NOT_DELIVERED");
    const unshipped = await paidOrder(buyer, seller, { shipmentStatus: null });
    expect((await rate(buyer, unshipped.id, { stars: 5 }).expect(409)).body.code).toBe("NOT_DELIVERED");
    await prisma.order.update({ where: { id: unshipped.id }, data: { status: "AWAITING_PAYMENT" } });
    expect((await rate(buyer, unshipped.id, { stars: 5 }).expect(409)).body.code).toBe("NOT_DELIVERED");
  });

  it("refuses stars outside 1 to 5, a half star, a missing value and a comment that is too long", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    for (const body of [{ stars: 0 }, { stars: 6 }, { stars: 3.5 }, { stars: "5" }, {}, { stars: 4, comment: "x".repeat(501) }]) {
      await rate(buyer, order.id, body).expect(400);
    }
    expect(await prisma.rating.count({ where: { orderId: order.id } })).toBe(0);
    await rate(buyer, order.id, { stars: 4, comment: "x".repeat(500) }).expect(201);
  });

  it("is also checked by the database: stars outside 1 to 5 cannot be saved", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    await expect(prisma.rating.create({ data: { orderId: order.id, buyerId: buyer.id, sellerId: seller.id, stars: 6 } })).rejects.toThrow();
    await expect(prisma.rating.create({ data: { orderId: order.id, buyerId: buyer.id, sellerId: seller.id, stars: 0 } })).rejects.toThrow();
  });

  describe("seller profile", () => {
    it("shows the average (one decimal), the count, the latest ratings with the buyer's username and the item, and nothing private", async () => {
      const seller = await makePerson();
      const buyers = [await makePerson(), await makePerson(), await makePerson()];
      const orders = [];
      for (const b of buyers) orders.push(await paidOrder(b, seller));
      await rate(buyers[0], orders[0].id, { stars: 5, comment: "Great" }).expect(201);
      await rate(buyers[1], orders[1].id, { stars: 4 }).expect(201);
      await rate(buyers[2], orders[2].id, { stars: 4, comment: "Good, slow to ship" }).expect(201);
      const profile = (await api().get(`/users/${seller.username}`).expect(200)).body;
      expect(profile.username).toBe(seller.username);
      expect(profile.rating).toEqual({ average: 4.3, count: 3 });
      expect(profile.ratings).toHaveLength(3);
      expect(profile.ratings[0]).toMatchObject({ stars: 4, comment: "Good, slow to ship", buyer: { username: buyers[2].username } });
      expect(profile.ratings[0].listingTitle).toContain("Rating test");
      const text = JSON.stringify(profile);
      expect(text).not.toContain(seller.email);
      expect(text).not.toContain(buyers[0].email);
      expect(text).not.toContain("Tester");
      expect((await api().get(`/users/${seller.username.toUpperCase()}`).expect(200)).body.username).toBe(seller.username);
    });

    it("has no average yet for a seller nobody has rated, and lists only what is on sale now", async () => {
      const [seller, buyer] = [await makePerson(), await makePerson()];
      const sold = await paidOrder(buyer, seller);
      const profile = (await api().get(`/users/${seller.username}`).expect(200)).body;
      expect(profile.rating).toEqual({ average: null, count: 0 });
      expect(profile.ratings).toEqual([]);
      expect(profile.listings).toEqual([]);

      const live = await prisma.listing.create({
        data: { sellerId: seller.id, title: "On sale now", description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 7, status: "PUBLISHED", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date(Date.now() - DAY) },
      });
      const draft = await prisma.listing.create({ data: { sellerId: seller.id, title: "A draft", description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 7 } });
      created.push(live.id, draft.id);
      const after = (await api().get(`/users/${seller.username}`).expect(200)).body;
      expect(after.listings.map((l: { id: string }) => l.id)).toEqual([live.id]);
      expect(after.listings[0]).toMatchObject({ title: "On sale now", phase: "live", startingPriceCents: 1000 });
      expect(after.listings.map((l: { id: string }) => l.id)).not.toContain(sold.listingId);
    });

    it("sends the seller's rating with their listing, to signed-in and signed-out viewers", async () => {
      const [seller, a, b] = [await makePerson(), await makePerson(), await makePerson()];
      const first = await paidOrder(a, seller);
      const second = await paidOrder(b, seller);
      const live = await prisma.listing.create({
        data: { sellerId: seller.id, title: "Rated seller listing", description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 7, status: "PUBLISHED", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date(Date.now() - DAY) },
      });
      created.push(live.id);
      expect((await api().get(`/listings/${live.id}`).expect(200)).body.sellerRating).toEqual({ average: null, count: 0 });
      await rate(a, first.id, { stars: 4 }).expect(201);
      await rate(b, second.id, { stars: 5 }).expect(201);
      expect((await api().get(`/listings/${live.id}`).expect(200)).body.sellerRating).toEqual({ average: 4.5, count: 2 });
      expect((await api().get(`/listings/${live.id}`).set(as(a)).expect(200)).body.sellerRating).toEqual({ average: 4.5, count: 2 });
    });

    it("answers 404 for a username that does not exist", async () => {
      await api().get("/users/no_such_person_here").expect(404);
    });
  });
});

import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { MailOutbox } from "../src/email/mail-outbox.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { FakePaymentProvider } from "../src/payments/fake-payment-provider";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { PayoutService } from "../src/payouts/payout.service";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

interface Person {
  id: string;
  email: string;
  token: string;
}

describe("seller payouts", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let emails: MailOutbox;
  let payouts: PayoutService;
  let provider: FakePaymentProvider;
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
      .useValue((provider = new FakePaymentProvider()))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    emails = app.get(MailOutbox);
    payouts = app.get(PayoutService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "pay-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.payout.deleteMany({ where: { order: { listingId: { in: created } } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePerson = async (): Promise<Person> => {
    const n = ++counter;
    const row = { id: `pay_${stamp}_${n}`, email: `pay-${n}-${stamp}@example.com`, firstName: "Pay", lastName: "Tester", username: `pa${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    await prisma.user.create({ data: row });
    return { id: row.id, email: row.email, token: await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret()) };
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
        title: `Payout test ${counter}`,
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

  const setUp = async (seller: Person) => {
    await api().post("/me/payout-account/onboarding").set(as(seller)).expect(201);
  };

  it("creates the seller's payment account on the first call to set up payouts, and reports its state", async () => {
    const seller = await makePerson();
    expect((await api().get("/me/payout-account").set(as(seller)).expect(200)).body.status).toBe("NOT_STARTED");
    await api().get("/me/payout-account").expect(401);
    const res = await api().post("/me/payout-account/onboarding").set(as(seller)).expect(201);
    expect(res.body.url).toContain("/account/settings?payouts=demo");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).payoutAccountId).toBe(`fake_acct_${seller.id}`);
    expect((await api().get("/me/payout-account").set(as(seller)).expect(200)).body.status).toBe("READY");
    provider.readyAccounts.clear();
    expect((await api().get("/me/payout-account").set(as(seller)).expect(200)).body.status).toBe("PENDING");
    await api().post("/me/payout-account/onboarding").set(as(seller)).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).payoutAccountId).toBe(`fake_acct_${seller.id}`);
  });

  it("pays the seller's share (price less fee, no delivery money) once, 3 days after delivery", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    await setUp(seller);
    const order = await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(4));
    const results = await Promise.all(Array.from({ length: 5 }, () => payouts.release(order.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(provider.payouts.filter((p) => p.orderId === order.id)).toEqual([
      { orderId: order.id, sellerId: seller.id, accountId: `fake_acct_${seller.id}`, amountCents: order.sellerNetCents, paymentRef: order.paymentRef },
    ]);
    const row = await prisma.payout.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(row).toMatchObject({ sellerId: seller.id, amountCents: 2992, reference: `fake_tr_${order.id}` });
    expect(await payouts.release(order.id)).toBe(false);

    await emails.sweep();
    const got = sent.filter((m) => m.to === seller.email && m.text.includes(`/orders/${order.id}`) && m.subject.includes("paid"));
    expect(got).toHaveLength(1);
    expect(got[0].text).toContain("€29.92");
  });

  it("does not pay before the delay has passed, before delivery, or to a seller without a ready account", async () => {
    const [seller, buyer, noAccount] = [await makePerson(), await makePerson(), await makePerson()];
    await setUp(seller);
    const early = await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(2));
    expect(await payouts.release(early.id)).toBe(false);
    const inTransit = await paidOrder(buyer, seller, { shipmentStatus: "IN_TRANSIT", trackingCode: "F", shippedAt: new Date(Date.now() - 9 * DAY), inTransitAt: new Date(Date.now() - 8 * DAY), deliveredAt: null });
    expect(await payouts.release(inTransit.id)).toBe(false);
    const nobody = await paidOrder(buyer, noAccount, DELIVERY_DAYS_AGO(4));
    expect(await payouts.release(nobody.id)).toBe(false);
    await setUp(noAccount);
    provider.readyAccounts.delete(`fake_acct_${noAccount.id}`);
    expect(await payouts.release(nobody.id)).toBe(false);
    provider.readyAccounts.add(`fake_acct_${noAccount.id}`);
    expect(await payouts.release(nobody.id)).toBe(true);
    expect(await prisma.payout.count({ where: { orderId: { in: [early.id, inTransit.id] } } })).toBe(0);
  });

  it("holds a banned seller's payout, and pays it once the ban is lifted", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    await setUp(seller);
    const order = await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(4));
    await prisma.user.update({ where: { id: seller.id }, data: { bannedAt: new Date(), banReason: "Fraud" } });
    expect(await payouts.release(order.id)).toBe(false);
    expect(await payouts.sweep()).toBe(0);
    expect(await prisma.payout.count({ where: { orderId: order.id } })).toBe(0);
    expect((await api().get(`/orders/${order.id}`).set(as(buyer)).expect(200)).body.sellerSuspended).toBe(true);
    await prisma.user.update({ where: { id: seller.id }, data: { bannedAt: null, banReason: null } });
    expect((await api().get(`/orders/${order.id}`).set(as(buyer)).expect(200)).body.sellerSuspended).toBeUndefined();
    expect(await payouts.release(order.id)).toBe(true);
  });

  it("has no early release: there is no way for the buyer to trigger a payout", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    await setUp(seller);
    const order = await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(1));
    await api().post(`/orders/${order.id}/confirm`).set(as(buyer));
    await api().post(`/orders/${order.id}/payout`).set(as(buyer)).expect(404);
    expect(await prisma.payout.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("shows the seller where their payout stands, and the buyer nothing", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(1));
    const view = async (p: Person) => (await api().get(`/orders/${order.id}`).set(as(p)).expect(200)).body;
    expect((await view(seller)).payout).toMatchObject({ status: "WAITING_FOR_ACCOUNT", amountCents: 2992 });
    await setUp(seller);
    expect((await view(seller)).payout).toMatchObject({ status: "SCHEDULED", paidAt: null });
    expect((await view(seller)).payout.dueAt).toBe(new Date(order.deliveredAt!.getTime() + 3 * DAY).toISOString());
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 4 * DAY) } });
    expect(await payouts.release(order.id)).toBe(true);
    expect((await view(seller)).payout).toMatchObject({ status: "PAID" });
    expect(await view(buyer)).not.toHaveProperty("payout");
  });

  it("sweeps up every due order, and leaves one whose provider call fails for a later run", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    await setUp(seller);
    const [a, b] = [await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(5)), await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(5))];
    const original = provider.payout.bind(provider);
    provider.payout = async (r) => {
      if (r.orderId === a.id) throw new Error("provider is down");
      return original(r);
    };
    await payouts.sweep();
    provider.payout = original;
    expect(await prisma.payout.count({ where: { orderId: a.id } })).toBe(0);
    expect(await prisma.payout.count({ where: { orderId: b.id } })).toBe(1);
    expect(await payouts.release(a.id)).toBe(true);
  });

  it("leaves an order whose seller has not finished setting up for later, instead of asking about it every sweep", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    await setUp(seller);
    provider.readyAccounts.delete(`fake_acct_${seller.id}`);
    const order = await paidOrder(buyer, seller, DELIVERY_DAYS_AGO(5));
    let asked = 0;
    const original = provider.isPayoutAccountReady.bind(provider);
    provider.isPayoutAccountReady = async (id) => {
      if (id === `fake_acct_${seller.id}`) asked++;
      return original(id);
    };
    await payouts.sweep();
    await payouts.sweep();
    provider.isPayoutAccountReady = original;
    expect(asked).toBe(1);
    expect(await prisma.payout.count({ where: { orderId: order.id } })).toBe(0);
  });
});

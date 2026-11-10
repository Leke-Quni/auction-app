import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { MailOutbox } from "../src/email/mail-outbox.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { StripePaymentProvider } from "../src/payments/stripe-payment-provider";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const SECRET = "whsec_race_secret";
const address = { name: "Ben Buyer", line1: "Rruga Myslym Shyri 7", city: "Tirana", postcode: "1001", country: "AL", phone: "+355 69 111 2222" };

// The webhook and the buyer coming back from Stripe both report the same payment, usually within moments of each other.
describe("Stripe: the webhook and the return from checkout racing", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let emails: MailOutbox;
  let listingId: string;
  let buyerToken: string;
  const sent: { to: string; subject: string }[] = [];
  const sessions = new Map<string, { amount_total: number; payment_status: string }>();
  const stripe = new Stripe("sk_test_dummy");
  const ids = { seller: `sr_${stamp}_s`, buyer: `sr_${stamp}_b` };
  const mine = { email: { startsWith: "sr-", endsWith: `-${stamp}@example.com` } };
  let round = 0;

  beforeAll(async () => {
    // A Stripe client that answers `sessions.retrieve` from our own table, so `confirm` runs without the network.
    const fakeClient = { checkout: { sessions: { retrieve: async (id: string) => ({ id, ...sessions.get(id) }), create: async () => ({ id: "x", url: "https://x" }) } }, webhooks: stripe.webhooks, refunds: { create: async () => ({}) } };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, subject: string) => void sent.push({ to, subject }) })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(new StripePaymentProvider(fakeClient as unknown as Stripe, SECRET))
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PRISMA);
    emails = app.get(MailOutbox);
    await prisma.user.createMany({
      data: Object.entries(ids).map(([n, id]) => ({ id, email: `sr-${n}-${stamp}@example.com`, firstName: "S", lastName: "R", username: `sr${n}${stamp}`.slice(0, 20), passwordHash: "!test", emailVerified: new Date() })),
    });
    buyerToken = await new SignJWT({ email: `sr-buyer-${stamp}@example.com`, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(ids.buyer).setExpirationTime("10m").sign(authSecret());
    const category = await prisma.category.findFirstOrThrow();
    listingId = (await prisma.listing.create({ data: { sellerId: ids.seller, title: "Race lamp", description: "x", categoryId: category.id, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED", startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - 1000), publishedAt: new Date(Date.now() - 4 * DAY) } })).id;
  });

  afterAll(async () => {
    await prisma.pendingEndEmail.deleteMany({ where: { listingId } });
    await prisma.order.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makeOrder = () => {
    const n = ++round;
    sessions.set(`cs_race_${n}`, { amount_total: 3450, payment_status: "paid" });
    return prisma.order.create({
      data: {
        listingId, round: n, buyerId: ids.buyer, sellerId: ids.seller, amountCents: 3150, feeCents: 158, sellerNetCents: 2992, payBy: new Date(Date.now() + DAY),
        shippingAddress: address, shippingOption: { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 }, shippingCents: 300, totalCents: 3450,
        paymentRef: `cs_race_${n}`, paymentRefs: [`cs_race_${n}`],
      },
    });
  };
  const webhook = (orderId: string, n: number) => {
    const payload = JSON.stringify({ id: `evt_race_${stamp}_${n}`, object: "event", type: "checkout.session.completed", data: { object: { id: `cs_race_${n}`, object: "checkout.session", client_reference_id: orderId, payment_status: "paid", amount_total: 3450, currency: "eur", metadata: { orderId } } } });
    return request(app.getHttpServer()).post("/payments/stripe/webhook").set("Content-Type", "application/json").set("Stripe-Signature", stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })).send(payload);
  };
  const confirm = (orderId: string) => request(app.getHttpServer()).post(`/orders/${orderId}/confirm`).set("Authorization", `Bearer ${buyerToken}`);

  it("marks the order paid once, with one invoice number and one pair of emails, however the reports interleave", async () => {
    const order = await makeOrder();
    const before = sent.length;
    const results = await Promise.all([webhook(order.id, 1), confirm(order.id), webhook(order.id, 1), confirm(order.id), webhook(order.id, 1), confirm(order.id)]);
    expect(results.map((r) => r.status)).toEqual([200, 201, 200, 201, 200, 201]);
    await Promise.all([emails.sweep(), emails.sweep()]);
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("PAID");
    expect(paid.invoiceNumber).toMatch(/^INV-/);
    expect(sent.slice(before).map((m) => m.subject.split(":")[0]).sort()).toEqual(["Payment completed", "Sold"]);
    expect(await prisma.pendingEndEmail.count({ where: { listingId, kind: { in: ["PAID", "SOLD"] }, userId: { in: [ids.buyer, ids.seller] } } })).toBe(0);
  });

  it("does not pay an order whose Stripe session was paid for a different amount", async () => {
    const order = await makeOrder();
    sessions.set(`cs_race_${round}`, { amount_total: 3150, payment_status: "paid" }); // the old, cheaper total
    expect((await confirm(order.id)).status).toBe(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("AWAITING_PAYMENT");
  });

  it("does not pay an order whose Stripe session is not paid", async () => {
    const order = await makeOrder();
    sessions.set(`cs_race_${round}`, { amount_total: 3450, payment_status: "unpaid" });
    expect((await confirm(order.id)).status).toBe(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("AWAITING_PAYMENT");
  });
});

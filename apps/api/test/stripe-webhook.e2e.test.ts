import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { StripePaymentProvider } from "../src/payments/stripe-payment-provider";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const SECRET = "whsec_test_secret";
const DAY = 86_400_000;

describe("Stripe webhook", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let stripe: Stripe;
  let listingId: string;
  const userIds = [`sw_${stamp}_s`, `sw_${stamp}_b`];
  const mine = { email: { startsWith: "sw-", endsWith: `-${stamp}@example.com` } };

  const refunded: string[] = [];
  const fakeClient = {} as { webhooks: Stripe["webhooks"]; checkout: unknown; refunds: unknown };

  beforeAll(async () => {
    stripe = new Stripe("sk_test_dummy");
    // Webhook signatures are checked for real; everything that would call Stripe is answered here.
    fakeClient.webhooks = stripe.webhooks;
    fakeClient.checkout = { sessions: { retrieve: async (id: string) => ({ id, payment_status: "paid", payment_intent: `pi_${id}` }) } };
    fakeClient.refunds = { create: async (args: { payment_intent: string }) => void refunded.push(args.payment_intent) };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async () => undefined })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(new StripePaymentProvider(fakeClient as unknown as Stripe, SECRET))
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PRISMA);
    await prisma.user.createMany({
      data: userIds.map((id, i) => ({ id, email: `sw-${i}-${stamp}@example.com`, firstName: "S", lastName: "W", username: `sw${i}x${stamp}`, passwordHash: "!test", emailVerified: new Date() })),
    });
    const category = await prisma.category.findFirstOrThrow();
    listingId = (
      await prisma.listing.create({
        data: {
          sellerId: userIds[0]!, title: "Webhook test", description: "x", categoryId: category.id, condition: "GOOD", startingPriceCents: 1000, durationDays: 3,
          status: "PUBLISHED", startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - 1000), publishedAt: new Date(Date.now() - 4 * DAY),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makeOrder = async (round: number, over: Record<string, unknown> = {}) =>
    prisma.order.create({
      data: { listingId, round, buyerId: userIds[1]!, sellerId: userIds[0]!, amountCents: 3150, feeCents: 158, sellerNetCents: 2992, shippingCents: 300, totalCents: 3450, payBy: new Date(Date.now() + DAY), paymentRef: `cs_test_${round}`, paymentRefs: [`cs_test_${round}`], ...over },
    });

  const sessionEvent = (orderId: string, round: number, over: Record<string, unknown> = {}, type = "checkout.session.completed") =>
    JSON.stringify({ id: `evt_${stamp}_${round}`, object: "event", type, data: { object: { id: `cs_test_${round}`, object: "checkout.session", client_reference_id: orderId, payment_status: "paid", amount_total: 3450, currency: "eur", metadata: { orderId }, ...over } } });

  const post = (payload: string, signed = true) => {
    const header = signed ? stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) : "t=1,v1=bad";
    return request(app.getHttpServer()).post("/payments/stripe/webhook").set("Content-Type", "application/json").set("Stripe-Signature", header).send(payload);
  };
  const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  it("marks the order paid on a signed completed-payment event, and a repeat changes nothing", async () => {
    const order = await makeOrder(1);
    const payload = sessionEvent(order.id, 1);
    expect((await post(payload)).status).toBe(200);
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("PAID");
    const paidAt = paid.paidAt;
    expect((await post(payload)).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt).toEqual(paidAt);
  });

  it("also accepts a delayed payment that succeeds later", async () => {
    const order = await makeOrder(2);
    expect((await post(sessionEvent(order.id, 2, {}, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    expect(await status(order.id)).toBe("PAID");
  });

  it("rejects a wrong signature and leaves the order alone", async () => {
    const order = await makeOrder(3);
    expect((await post(sessionEvent(order.id, 3), false)).status).toBe(400);
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
  });

  it("rejects a call with no signature", async () => {
    const res = await request(app.getHttpServer()).post("/payments/stripe/webhook").set("Content-Type", "application/json").send("{}");
    expect(res.status).toBe(400);
  });

  it("ignores an unpaid session and a session that is not one of the order's, without refunding anything", async () => {
    const order = await makeOrder(4);
    refunded.length = 0;
    for (const over of [{ payment_status: "unpaid" }, { id: "cs_test_other" }]) {
      expect((await post(sessionEvent(order.id, 4, over))).status).toBe(200);
      expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    }
    expect(refunded).toEqual([]);
  });

  it("refunds a payment for a different amount or currency and leaves the order waiting", async () => {
    const order = await makeOrder(6);
    refunded.length = 0;
    for (const over of [{ amount_total: 100 }, { currency: "usd" }]) {
      expect((await post(sessionEvent(order.id, 6, over))).status).toBe(200);
      expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    }
    expect(refunded).toEqual(["pi_cs_test_6", "pi_cs_test_6"]);
  });

  it("refunds a payment that lands on an order that already expired, and does not reopen it", async () => {
    const order = await makeOrder(5, { status: "EXPIRED" });
    refunded.length = 0;
    expect((await post(sessionEvent(order.id, 5))).status).toBe(200);
    expect(await status(order.id)).toBe("EXPIRED");
    expect(refunded).toEqual(["pi_cs_test_5"]);
  });

  it("refunds a second paid session of the same order, never the one that paid it, and a repeat of the paying event changes nothing", async () => {
    const order = await makeOrder(7, { paymentRefs: ["cs_test_7", "cs_test_7b"] });
    refunded.length = 0;
    expect((await post(sessionEvent(order.id, 7))).status).toBe(200);
    expect(await status(order.id)).toBe("PAID");
    expect(refunded).toEqual(["pi_cs_test_7b"]); // closing the order's other sessions found it paid too (the stub says every session is)
    refunded.length = 0;
    expect((await post(sessionEvent(order.id, 7))).status).toBe(200);
    expect(refunded).toEqual([]);
    const second = JSON.stringify({ id: `evt_${stamp}_7b`, object: "event", type: "checkout.session.completed", data: { object: { id: "cs_test_7b", object: "checkout.session", client_reference_id: order.id, payment_status: "paid", amount_total: 3450, currency: "eur", metadata: { orderId: order.id } } } });
    expect((await post(second)).status).toBe(200);
    expect(await status(order.id)).toBe("PAID");
    expect(refunded).toEqual(["pi_cs_test_7b"]); // asked again; Stripe refunds a payment only once
  });

  it("answers an error, so Stripe tries again, when a refund that is owed fails", async () => {
    const order = await makeOrder(8, { status: "EXPIRED" });
    const real = fakeClient.refunds;
    fakeClient.refunds = { create: async () => { throw new Error("stripe is down"); } };
    try {
      expect((await post(sessionEvent(order.id, 8))).status).toBe(500);
    } finally {
      fakeClient.refunds = real;
    }
  });

  it("answers 200 for event types it does not use", async () => {
    expect((await post(JSON.stringify({ id: "evt_x", object: "event", type: "charge.succeeded", data: { object: {} } }))).status).toBe(200);
  });
});

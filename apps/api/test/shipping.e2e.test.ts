import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionEndEmailService } from "../src/auctions/auction-end-email.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailAttachment } from "../src/email/mail-sender";
import { FakePaymentProvider } from "../src/payments/fake-payment-provider";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const address = { name: "Ada Buyer", line1: "Rr. Nene Tereza 1", city: "Tirana", postcode: "1001", country: "AL", phone: "+355 69 111 2222" };
const pickup = { name: "Sam Seller", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344000111" };

describe("shipping, paid emails and invoice", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let provider: FakePaymentProvider;
  let emails: AuctionEndEmailService;
  let listingId: string;
  let counter = 0;
  const sent: { to: string; subject: string; text: string; attachments: MailAttachment[] }[] = [];
  const ids = { seller: `sh_${stamp}_s`, buyer: `sh_${stamp}_b`, stranger: `sh_${stamp}_x` };
  const tokens: Record<string, string> = {};
  const mine = { email: { startsWith: "sh-", endsWith: `-${stamp}@example.com` } };
  const api = () => request(app.getHttpServer());
  const as = (who: keyof typeof ids) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    provider = new FakePaymentProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, subject: string, text: string, attachments: MailAttachment[] = []) => void sent.push({ to, subject, text, attachments }) })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    emails = app.get(AuctionEndEmailService);
    const entries = Object.entries(ids);
    await prisma.user.createMany({
      data: entries.map(([name, id]) => ({ id, email: `sh-${name}-${stamp}@example.com`, firstName: "S", lastName: "H", username: `sh${name}${stamp}`.slice(0, 20), passwordHash: "!test", emailVerified: new Date() })),
    });
    for (const [name, id] of entries) {
      tokens[name] = await new SignJWT({ email: `sh-${name}-${stamp}@example.com`, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(id).setExpirationTime("10m").sign(authSecret());
    }
    const category = await prisma.category.findFirstOrThrow();
    listingId = (
      await prisma.listing.create({
        data: {
          sellerId: ids.seller, title: "Shipping test lamp", description: "x", categoryId: category.id, condition: "GOOD", startingPriceCents: 1000, durationDays: 3,
          pickupAddress: pickup, status: "PUBLISHED", startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - 1000), publishedAt: new Date(Date.now() - 4 * DAY),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.pendingEndEmail.deleteMany({ where: { listingId } });
    await prisma.order.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makeOrder = (over: Record<string, unknown> = {}) =>
    prisma.order.create({ data: { listingId, round: ++counter, buyerId: ids.buyer, sellerId: ids.seller, amountCents: 3150, feeCents: 158, sellerNetCents: 2992, pickupAddress: pickup, payBy: new Date(Date.now() + DAY), ...over } });
  const options = (orderId: string, who: keyof typeof ids = "buyer") => api().get(`/orders/${orderId}/shipping/options`).set(as(who));

  it("prices delivery as 5% of the item (at least 3 euros, at most 50) plus the option's extra", async () => {
    const order = await makeOrder(); // 5% of 31.50 is 1.58, so the 3 euro minimum applies
    const res = await options(order.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 },
      { id: "express", name: "Express", estimatedDays: 2, tracked: true, insured: true, priceCents: 900 },
      { id: "insured", name: "Tracked and insured", estimatedDays: 6, tracked: true, insured: true, priceCents: 700 },
    ]);
    const mid = await makeOrder({ amountCents: 40_000 }); // 5% is 20 euros
    expect((await options(mid.id)).body.map((o: { priceCents: number }) => o.priceCents)).toEqual([2000, 2600, 2400]);
    const big = await makeOrder({ amountCents: 5_000_000 }); // 5% would be 2,500 euros: capped at 50
    expect((await options(big.id)).body.map((o: { priceCents: number }) => o.priceCents)).toEqual([5000, 5600, 5400]);
  });

  it("shows the options only to the buyer of a waiting order", async () => {
    const order = await makeOrder();
    await options(order.id, "seller").expect(403);
    await options(order.id, "stranger").expect(404);
  });

  it("refuses payment until the delivery is chosen, then charges the item plus the delivery", async () => {
    const order = await makeOrder();
    expect((await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(409)).body.code).toBe("SHIPPING_REQUIRED");
    const saved = await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "express" }).expect(200);
    expect(saved.body).toMatchObject({ totalCents: 3150 + 900, shipping: { name: "Express", priceCents: 900, address: { city: "Tirana", line1: "Rr. Nene Tereza 1" } } });
    expect(saved.body).not.toHaveProperty("pickupAddress"); // the buyer never sees where the seller is
    await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
    const [session] = [...provider.sessions.values()].slice(-1);
    expect(session).toMatchObject({ orderId: order.id, amountCents: 3150, shippingCents: 900 });
  });

  it("never takes a price from the browser, and rejects an unknown option or a bad address", async () => {
    const order = await makeOrder();
    const saved = (await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "standard", priceCents: 1 }).expect(200)).body;
    expect(saved.shipping.priceCents).toBe(300);
    expect((await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "free-teleport" }).expect(409)).body.code).toBe("SHIPPING_OPTION_UNAVAILABLE");
    await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: { ...address, phone: "abc" }, optionId: "standard" }).expect(400);
    await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: { ...address, country: "ZZ" }, optionId: "standard" }).expect(400);
  });

  it("shows the seller the pickup address and only the destination city, never the buyer's street or phone", async () => {
    const order = await makeOrder();
    await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "standard" }).expect(200);
    const view = (await api().get(`/orders/${order.id}`).set(as("seller")).expect(200)).body;
    expect(view.pickupAddress).toMatchObject({ line1: "Rr. Dardania 12", phone: "+38344000111" });
    expect(view.shipping.address).toEqual({ city: "Tirana", country: "AL" });
    expect(JSON.stringify(view)).not.toContain("Nene Tereza");
    expect(JSON.stringify(view)).not.toContain("355 69");
  });

  it("lets only the buyer of a waiting order choose the delivery", async () => {
    const order = await makeOrder();
    const body = { address, optionId: "standard" };
    await api().put(`/orders/${order.id}/shipping`).set(as("seller")).send(body).expect(403);
    await api().put(`/orders/${order.id}/shipping`).set(as("stranger")).send(body).expect(404);
    await prisma.order.update({ where: { id: order.id }, data: { status: "EXPIRED" } });
    expect((await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send(body).expect(409)).body.code).toBe("NOT_PAYABLE");
  });

  it("sends the confirmation to the buyer and the sold notice to the seller once, with the invoice, however the payment is reported", async () => {
    sent.length = 0;
    const order = await makeOrder();
    await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "insured" }).expect(200);
    await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
    const ref = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
    provider.simulatePayment(ref);
    const results = await Promise.all([1, 2, 3].map(() => api().post(`/orders/${order.id}/confirm`).set(as("buyer"))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    await emails.sweep();
    await emails.sweep();

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe("PAID");
    expect(paid.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    const mails = sent.filter((m) => m.subject.includes("Shipping test lamp"));
    expect(mails.map((m) => m.to).sort()).toEqual([`sh-buyer-${stamp}@example.com`, `sh-seller-${stamp}@example.com`]);
    const buyerMail = mails.find((m) => m.to.includes("buyer"))!;
    expect(buyerMail.subject).toContain("Payment completed");
    expect(buyerMail.text).toContain(paid.invoiceNumber!);
    expect(buyerMail.text).toContain("Rr. Nene Tereza 1");
    expect(buyerMail.text).toContain("Tracked and insured");
    expect(buyerMail.text).not.toContain("Dardania"); // the buyer is not told where the seller is
    expect(buyerMail.attachments[0]!.filename).toBe(`${paid.invoiceNumber}.pdf`);
    expect(buyerMail.attachments[0]!.content.subarray(0, 4).toString()).toBe("%PDF");
    const sellerMail = mails.find((m) => m.to.includes("seller"))!;
    expect(sellerMail.text).toContain("Rr. Dardania 12"); // where the carrier collects
    expect(sellerMail.text).toContain("collect");
    expect(sellerMail.text).not.toContain("Nene Tereza"); // the buyer's street and phone stay private
    expect(sellerMail.text).not.toContain("355 69");
    expect(sellerMail.text).toContain("You receive");
  });

  it("does not mark an order paid for a session of a different amount", async () => {
    const order = await makeOrder();
    await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "standard" }).expect(200);
    await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
    const ref = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
    provider.simulatePayment(ref);
    // The buyer changes the delivery after that session was made: the paid session was for another total.
    await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "express" }).expect(200);
    expect((await api().post(`/orders/${order.id}/confirm`).set(as("buyer")).expect(201)).body.status).toBe("AWAITING_PAYMENT");
  });

  it("serves the invoice PDF to the buyer and seller of a paid order only", async () => {
    const order = await makeOrder();
    await api().get(`/orders/${order.id}/invoice`).set(as("buyer")).expect(409);
    await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address, optionId: "standard" }).expect(200);
    await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
    provider.simulatePayment((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!);
    await api().post(`/orders/${order.id}/confirm`).set(as("buyer")).expect(201);
    for (const who of ["buyer", "seller"] as const) {
      const res = await api().get(`/orders/${order.id}/invoice`).set(as(who)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    }
    await api().get(`/orders/${order.id}/invoice`).set(as("stranger")).expect(404);
  });

  it("gives each paid order its own invoice number", async () => {
    const numbers = await prisma.order.findMany({ where: { listingId, invoiceNumber: { not: null } }, select: { invoiceNumber: true } });
    expect(new Set(numbers.map((n) => n.invoiceNumber)).size).toBe(numbers.length);
  });

  it("keeps a seller's default pickup address and offers it back", async () => {
    expect((await api().get("/me/pickup-address").set(as("seller")).expect(200)).body).toEqual({ pickupAddress: null });
    await api().put("/me/pickup-address").set(as("seller")).send({ ...pickup, phone: "abc" }).expect(400);
    const saved = (await api().put("/me/pickup-address").set(as("seller")).send(pickup).expect(200)).body;
    expect(saved.pickupAddress).toMatchObject({ line1: "Rr. Dardania 12" });
    expect((await api().get("/me/pickup-address").set(as("seller")).expect(200)).body.pickupAddress).toMatchObject({ city: "Prizren" });
    expect((await api().get("/me/pickup-address").set(as("buyer")).expect(200)).body).toEqual({ pickupAddress: null }); // not shared between people
  });
});

import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { MailOutbox } from "../src/email/mail-outbox.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { FakePaymentProvider } from "../src/payments/fake-payment-provider";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { ShipmentProgressService } from "../src/orders/shipment-progress.service";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

interface Person {
  id: string;
  email: string;
  token: string;
}

describe("shipments", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let emails: MailOutbox;
  let progress: ShipmentProgressService;
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
    emails = app.get(MailOutbox);
    progress = app.get(ShipmentProgressService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterEach(() => {
    delete process.env.FAKE_CARRIER_IN_TRANSIT_SECONDS;
    delete process.env.FAKE_CARRIER_DELIVERED_SECONDS;
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "shp-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePerson = async (): Promise<Person> => {
    const n = ++counter;
    const row = { id: `shp_${stamp}_${n}`, email: `shp-${n}-${stamp}@example.com`, firstName: "Shp", lastName: "Tester", username: `sh${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    await prisma.user.create({ data: row });
    return { id: row.id, email: row.email, token: await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret()) };
  };

  const address = { name: "Ada Buyer", line1: "Rr. Nene Tereza 1", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344111222" };
  const option = { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 };

  // A sold, closed and paid order with its delivery chosen.
  const paidOrder = async (buyer: Person, seller: Person, trackingEmails = true) => {
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: `Shipment test ${counter}`,
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
    const paid = await prisma.order.update({
      where: { id: found.id },
      data: { status: "PAID", paidAt: new Date(), invoiceNumber: `INV-TEST-${stamp}-${counter}`, shippingAddress: address, shippingOption: option, shippingCents: 300, totalCents: 3450, trackingEmails },
    });
    // Closing starts a background mail sweep at once. If it read the order before it was marked paid, it sent the buyer's
    // "pay now" email, which links to the same order page the tests count mail by. Let any sweep in progress finish, send
    // what is left (the pay-now email is skipped now that the order is paid), then forget that email.
    await emails.sweep();
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].to === buyer.email && sent[i].subject.endsWith(": pay now")) sent.splice(i, 1);
    return paid;
  };

  it("lets the seller mark a paid order shipped, once, and tells the buyer", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    const res = await api().post(`/orders/${order.id}/ship`).set(as(seller)).expect(201);
    expect(res.body.shipment).toMatchObject({ status: "LABEL_CREATED", inTransitAt: null, deliveredAt: null });
    expect(res.body.shipment.trackingCode).toMatch(/^FAKE/);
    expect((await api().get(`/orders/${order.id}`).set(as(buyer)).expect(200)).body.shipment.trackingCode).toBe(res.body.shipment.trackingCode);

    const again = await api().post(`/orders/${order.id}/ship`).set(as(seller)).expect(409);
    expect(again.body.code).toBe("ALREADY_SHIPPED");

    await emails.sweep();
    const got = sent.filter((m) => m.to === buyer.email && m.text.includes(`/orders/${order.id}`));
    expect(got).toHaveLength(1);
    expect(got[0].subject).toContain("on its way");
    expect(got[0].text).toContain(res.body.shipment.trackingCode);
  });

  it("refuses everyone but the seller, and an order that is not paid", async () => {
    const [seller, buyer, stranger] = [await makePerson(), await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    expect((await api().post(`/orders/${order.id}/ship`).set(as(buyer)).expect(403)).body.code).toBe("NOT_SELLER");
    await api().post(`/orders/${order.id}/ship`).set(as(stranger)).expect(404);
    await api().post(`/orders/${order.id}/ship`).expect(401);
    await prisma.order.update({ where: { id: order.id }, data: { status: "AWAITING_PAYMENT", paidAt: null } });
    expect((await api().post(`/orders/${order.id}/ship`).set(as(seller)).expect(409)).body.code).toBe("NOT_PAID");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).shipmentStatus).toBeNull();
  });

  it("marks a double click shipped only once", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    const results = await Promise.all(Array.from({ length: 5 }, () => api().post(`/orders/${order.id}/ship`).set(as(seller))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.pendingEndEmail.count({ where: { listingId: order.listingId, kind: "SHIPPED" } })).toBe(1);
  });

  it("moves the parcel to in transit and then delivered as time passes, with one email for each", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    await api().post(`/orders/${order.id}/ship`).set(as(seller)).expect(201);
    await emails.sweep();

    process.env.FAKE_CARRIER_IN_TRANSIT_SECONDS = "3600";
    process.env.FAKE_CARRIER_DELIVERED_SECONDS = "7200";
    expect(await progress.advance(order.id)).toBeNull();

    process.env.FAKE_CARRIER_IN_TRANSIT_SECONDS = "0";
    expect(await progress.advance(order.id)).toBe("IN_TRANSIT");
    expect(await progress.advance(order.id)).toBeNull();
    await emails.sweep();
    let row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.shipmentStatus).toBe("IN_TRANSIT");
    expect(row.inTransitAt).not.toBeNull();

    process.env.FAKE_CARRIER_DELIVERED_SECONDS = "0";
    const results = await Promise.all(Array.from({ length: 5 }, () => progress.advance(order.id)));
    expect(results.filter((r) => r === "DELIVERED")).toHaveLength(1);
    row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.shipmentStatus).toBe("DELIVERED");
    expect(row.deliveredAt).not.toBeNull();
    expect(await progress.advance(order.id)).toBeNull();

    await emails.sweep();
    const subjects = sent.filter((m) => m.to === buyer.email && m.text.includes(`/orders/${order.id}`)).map((m) => m.subject);
    expect(subjects.some((s) => s.includes("on its way"))).toBe(true);
    expect(subjects.some((s) => s.includes("in transit"))).toBe(true);
    expect(subjects.some((s) => s.includes("delivered"))).toBe(true);
    expect(subjects).toHaveLength(3);
  });

  it("sends only the delivered email when a parcel is found already delivered (the machine was stopped)", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    await api().post(`/orders/${order.id}/ship`).set(as(seller)).expect(201);
    process.env.FAKE_CARRIER_IN_TRANSIT_SECONDS = "0";
    process.env.FAKE_CARRIER_DELIVERED_SECONDS = "0";
    expect(await progress.advance(order.id)).toBe("DELIVERED");
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.inTransitAt).not.toBeNull();
    expect(await prisma.pendingEndEmail.count({ where: { listingId: order.listingId, kind: { in: ["IN_TRANSIT", "DELIVERED"] } } })).toBe(1);
  });

  it("sends no shipping emails to a buyer who did not ask for them, but still tracks the parcel", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller, false);
    const before = sent.length;
    const res = await api().post(`/orders/${order.id}/ship`).set(as(seller)).expect(201);
    process.env.FAKE_CARRIER_IN_TRANSIT_SECONDS = "0";
    process.env.FAKE_CARRIER_DELIVERED_SECONDS = "0";
    expect(await progress.advance(order.id)).toBe("DELIVERED");
    expect(await prisma.pendingEndEmail.count({ where: { listingId: order.listingId, kind: { in: ["SHIPPED", "IN_TRANSIT", "DELIVERED"] } } })).toBe(0);
    await emails.sweep();
    expect(sent.slice(before).filter((m) => m.to === buyer.email && m.text.includes(`/orders/${order.id}`))).toHaveLength(0);
    const seen = (await api().get(`/orders/${order.id}`).set(as(buyer)).expect(200)).body;
    expect(seen).toMatchObject({ trackingEmails: false, shipment: { status: "DELIVERED", trackingCode: res.body.shipment.trackingCode } });
  });

  it("saves the buyer's tracking-emails choice with the delivery, off by default, and keeps it from the seller", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    await prisma.order.update({ where: { id: order.id }, data: { status: "AWAITING_PAYMENT", paidAt: null, trackingEmails: false } });
    const body = { address, optionId: "standard" };
    expect((await api().put(`/orders/${order.id}/shipping`).set(as(buyer)).send(body).expect(200)).body.trackingEmails).toBe(false);
    expect((await api().put(`/orders/${order.id}/shipping`).set(as(buyer)).send({ ...body, trackingEmails: true }).expect(200)).body.trackingEmails).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).trackingEmails).toBe(true);
    expect((await api().get(`/orders/${order.id}`).set(as(seller)).expect(200)).body).not.toHaveProperty("trackingEmails");
  });

  it("does not send an old 'on its way' or 'in transit' email once the parcel has moved on", async () => {
    const [seller, buyer] = [await makePerson(), await makePerson()];
    const order = await paidOrder(buyer, seller);
    await api().post(`/orders/${order.id}/ship`).set(as(seller)).expect(201);
    process.env.FAKE_CARRIER_IN_TRANSIT_SECONDS = "0";
    process.env.FAKE_CARRIER_DELIVERED_SECONDS = "0";
    await progress.advance(order.id);
    // The shipped notice is still waiting (a retry that came due late), but the parcel is already delivered.
    await prisma.pendingEndEmail.upsert({
      where: { userId_listingId_kind: { userId: buyer.id, listingId: order.listingId, kind: "SHIPPED" } },
      create: { userId: buyer.id, listingId: order.listingId, kind: "SHIPPED" },
      update: { dueAt: new Date(Date.now() - 1000) },
    });
    const before = sent.length;
    await emails.sweep();
    const subjects = sent.slice(before).filter((m) => m.to === buyer.email && m.text.includes(`/orders/${order.id}`)).map((m) => m.subject);
    expect(subjects.some((s) => s.includes("on its way"))).toBe(false);
    expect(subjects.some((s) => s.includes("delivered"))).toBe(true);
    expect(await prisma.pendingEndEmail.count({ where: { listingId: order.listingId, kind: "SHIPPED" } })).toBe(0);
  });
});

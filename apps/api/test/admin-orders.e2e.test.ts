import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

const deliveryAddress = { name: "Arta Krasniqi", line1: "Rr. Dardania 12", line2: "Apt 4", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344123456" };
const pickupAddress = { name: "Dren Berisha", line1: "Rr. Nene Tereza 5", city: "Pristina", postcode: "10000", country: "XK", phone: "+38349765432" };
const option = { id: "express", name: "Express", estimatedDays: 2, tracked: true, insured: false, priceCents: 900 };

describe("the admin's view of an order", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let categoryId: string;
  const userIds: string[] = [];
  const listingIds: string[] = [];

  type Who = { id: string; email: string; username: string; auth: Record<string, string> };
  const person = async (role: "USER" | "ADMIN" = "USER", over: Record<string, unknown> = {}): Promise<Who> => {
    const n = ++counter;
    const row = { id: `ao_${stamp}_${n}`, email: `ao-${n}-${stamp}@example.com`, firstName: "Order", lastName: `Person${n}`, username: `ao${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date(), role, ...over };
    await prisma.user.create({ data: row as never });
    userIds.push(row.id);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret());
    return { id: row.id, email: row.email, username: row.username, auth: { Authorization: `Bearer ${token}` } };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.adminAction.deleteMany({ where: { adminId: { in: userIds } } });
    await prisma.rating.deleteMany({ where: { order: { listingId: { in: listingIds } } } });
    await prisma.payout.deleteMany({ where: { order: { listingId: { in: listingIds } } } });
    await prisma.order.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // A sold listing and its order between a new buyer and seller.
  const order = async (over: Record<string, unknown> = {}, sellerOver: Record<string, unknown> = {}) => {
    const seller = await person("USER", sellerOver);
    const buyer = await person();
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id, title: `Order lamp ${stamp}-${++counter}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED",
        startsAt: new Date(Date.now() - 5 * DAY), endsAt: new Date(Date.now() - 4 * DAY), publishedAt: new Date(Date.now() - 5 * DAY), currentBidCents: 4500, bidCount: 1, highBidderId: buyer.id,
        closedAt: new Date(Date.now() - 4 * DAY), outcome: "SOLD", winnerId: buyer.id, finalPriceCents: 4500, pickupAddress,
      },
    });
    listingIds.push(listing.id);
    const row = await prisma.order.create({
      data: { listingId: listing.id, buyerId: buyer.id, sellerId: seller.id, amountCents: 4500, feeCents: 225, sellerNetCents: 4275, payBy: new Date(Date.now() + DAY), pickupAddress, ...over } as never,
    });
    return { buyer, seller, listing, order: row };
  };
  const paid = { status: "PAID", paidAt: new Date(Date.now() - 3 * DAY), shippingAddress: deliveryAddress, shippingOption: option, shippingCents: 900, totalCents: 5400, invoiceNumber: undefined, paymentRef: "cs_test_abc", paymentRefs: ["cs_test_old", "cs_test_abc"], trackingEmails: true };
  const get = (who: Who, path: string) => request(url).get(path).set(who.auth);

  it("is for admins only", async () => {
    const user = await person();
    const { order: o } = await order();
    await request(url).get(`/admin/orders/${o.id}`).expect(401);
    await get(user, `/admin/orders/${o.id}`).expect(403);
    await get(user, "/admin/orders").expect(403);
  });

  it("shows a paid, shipped order with both full addresses, every amount and the payout", async () => {
    const admin = await person("ADMIN");
    const { buyer, seller, listing, order: o } = await order({ ...paid, invoiceNumber: `INV-2026-${String(stamp).slice(-6)}`, shipmentStatus: "DELIVERED", trackingCode: "FAKE123", shippedAt: new Date(Date.now() - 2.5 * DAY), inTransitAt: new Date(Date.now() - 2 * DAY), deliveredAt: new Date(Date.now() - 1 * DAY) });
    const res = (await get(admin, `/admin/orders/${o.id}`).expect(200)).body;
    expect(await prisma.adminAction.findMany({ where: { targetId: o.id } })).toMatchObject([{ action: "VIEW_ORDER", adminId: admin.id }]);
    expect(res).toMatchObject({
      id: o.id, status: "PAID", round: 1, listing: { id: listing.id, title: listing.title },
      buyer: { id: buyer.id, username: buyer.username, email: buyer.email, name: expect.stringContaining("Order") },
      seller: { id: seller.id, email: seller.email, hasPayoutAccount: false },
      amounts: { itemCents: 4500, feeCents: 225, sellerNetCents: 4275, shippingCents: 900, totalCents: 5400 },
      paymentRef: "cs_test_abc", paymentAttempts: 2,
      delivery: { address: deliveryAddress, option, trackingEmails: true },
      pickupAddress,
      shipment: { status: "DELIVERED", trackingCode: "FAKE123" },
      rating: null,
    });
    expect(res.invoiceNumber).toMatch(/^INV-2026-/);
    // Delivered a day ago, so the payout is not yet due, and the seller has no payment account to be paid into.
    expect(res.payout).toMatchObject({ status: "WAITING_FOR_ACCOUNT", amountCents: 4275, paidAt: null, reference: null });
  });

  it("shows what the seller is never sent, which is the buyer's street and phone, and what the buyer is never sent, the pickup address", async () => {
    const admin = await person("ADMIN");
    const { buyer, seller, order: o } = await order(paid);
    const sellerView = (await get(seller, `/orders/${o.id}`).expect(200)).body;
    expect(JSON.stringify(sellerView)).not.toContain("Dardania");
    expect(JSON.stringify(sellerView)).not.toContain("+38344123456");
    const buyerView = (await get(buyer, `/orders/${o.id}`).expect(200)).body;
    expect(JSON.stringify(buyerView)).not.toContain("Nene Tereza");
    const adminView = (await get(admin, `/admin/orders/${o.id}`).expect(200)).body;
    expect(adminView.delivery.address).toMatchObject({ line1: "Rr. Dardania 12", phone: "+38344123456" });
    expect(adminView.pickupAddress).toMatchObject({ line1: "Rr. Nene Tereza 5", phone: "+38349765432" });
  });

  it("reports the payout as scheduled, then paid with its reference, and shows a rating", async () => {
    const admin = await person("ADMIN");
    const { buyer, seller, order: o } = await order({ ...paid, shipmentStatus: "DELIVERED", trackingCode: "T1", shippedAt: new Date(Date.now() - 6 * DAY), deliveredAt: new Date(Date.now() - 4 * DAY) }, { payoutAccountId: `acct_${stamp}` });
    expect((await get(admin, `/admin/orders/${o.id}`).expect(200)).body.payout).toMatchObject({ status: "SCHEDULED", amountCents: 4275, paidAt: null });
    await prisma.payout.create({ data: { orderId: o.id, sellerId: seller.id, amountCents: 4275, reference: `tr_${stamp}` } });
    await prisma.rating.create({ data: { orderId: o.id, buyerId: buyer.id, sellerId: seller.id, stars: 4, comment: "Arrived well packed" } });
    const res = (await get(admin, `/admin/orders/${o.id}`).expect(200)).body;
    expect(res.seller.hasPayoutAccount).toBe(true);
    expect(res.payout).toMatchObject({ status: "PAID", reference: `tr_${stamp}`, amountCents: 4275 });
    expect(res.rating).toMatchObject({ stars: 4, comment: "Arrived well packed" });
  });

  it("shows an unpaid order without delivery, shipment or payout, and an expired one as it ended", async () => {
    const admin = await person("ADMIN");
    const waiting = await order();
    const res = (await get(admin, `/admin/orders/${waiting.order.id}`).expect(200)).body;
    expect(res).toMatchObject({ status: "AWAITING_PAYMENT", delivery: null, shipment: null, payout: null, paidAt: null, invoiceNumber: null });
    expect(res.pickupAddress).toMatchObject({ line1: "Rr. Nene Tereza 5" });
    const expired = await order({ status: "EXPIRED", round: 2 });
    expect((await get(admin, `/admin/orders/${expired.order.id}`).expect(200)).body).toMatchObject({ status: "EXPIRED", round: 2, payout: null });
    await get(admin, "/admin/orders/nope").expect(404);
  });

  it("finds orders by id, listing, invoice number, buyer or seller, newest first, and by status", async () => {
    const admin = await person("ADMIN");
    const a = await order({ ...paid, invoiceNumber: `INV-2026-${String(stamp).slice(-5)}9`, createdAt: new Date(Date.now() - 2 * DAY) });
    const b = await order({ createdAt: new Date(Date.now() - 1 * DAY) });
    const ids = async (q: string) => (await get(admin, `/admin/orders?q=${encodeURIComponent(q)}`).expect(200)).body.orders.map((x: { id: string }) => x.id);
    expect(await ids(a.order.id)).toEqual([a.order.id]);
    expect(await ids(a.listing.id)).toEqual([a.order.id]);
    expect(await ids(a.listing.title)).toEqual([a.order.id]);
    expect(await ids(a.buyer.username.toUpperCase())).toEqual([a.order.id]);
    expect(await ids(a.seller.email)).toEqual([a.order.id]);
    expect(await ids(`INV-2026-${String(stamp).slice(-5)}9`)).toEqual([a.order.id]);
    const row = (await get(admin, `/admin/orders?q=${a.order.id}`).expect(200)).body.orders[0];
    expect(row).toMatchObject({ status: "PAID", listing: { title: a.listing.title }, buyer: { username: a.buyer.username }, seller: { username: a.seller.username }, amountCents: 4500, totalCents: 5400 });
    const mine = (await get(admin, `/admin/orders?q=Order%20lamp%20${stamp}&limit=100`).expect(200)).body.orders.map((x: { id: string }) => x.id);
    expect(mine.indexOf(b.order.id)).toBeLessThan(mine.indexOf(a.order.id));
    const paidOnly = (await get(admin, `/admin/orders?status=PAID&q=Order%20lamp%20${stamp}&limit=100`).expect(200)).body.orders.map((x: { id: string }) => x.id);
    expect(paidOnly).toContain(a.order.id);
    expect(paidOnly).not.toContain(b.order.id);
    await get(admin, "/admin/orders?status=SHIPPED").expect(400);
    await get(admin, "/admin/orders?limit=0").expect(400);
  });

  it("changes nothing: reading an order twice leaves it as it was", async () => {
    const admin = await person("ADMIN");
    const { order: o } = await order(paid);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    await get(admin, `/admin/orders/${o.id}`).expect(200);
    await get(admin, `/admin/orders/${o.id}`).expect(200);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).toEqual(before);
  });

  it("hands an admin the buyer's invoice and the seller's statement of a paid order as PDFs, and writes each look to the audit trail", async () => {
    const admin = await person("ADMIN");
    const user = await person();
    const { order: o } = await order({ ...paid, invoiceNumber: `INV-2027-${String(stamp).slice(-6)}`, shipmentStatus: "DELIVERED" });
    const pdf = (who: Who, party: string) => request(url).get(`/admin/orders/${o.id}/invoice?party=${party}`).set(who.auth).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    await request(url).get(`/admin/orders/${o.id}/invoice?party=buyer`).expect(401);
    await pdf(user, "buyer").expect(403);
    await pdf(admin, "nobody").expect(400);

    for (const party of ["buyer", "seller"]) {
      const res = await pdf(admin, party).expect(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain(".pdf");
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    }
    const log = await prisma.adminAction.findMany({ where: { targetId: o.id, action: "VIEW_INVOICE" }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => [l.adminId, l.reason])).toEqual([[admin.id, "buyer"], [admin.id, "seller"]]);
    // Opening the same one again within a minute (a double click, a prefetch) is not written twice.
    await pdf(admin, "buyer").expect(200);
    expect(await prisma.adminAction.count({ where: { targetId: o.id, action: "VIEW_INVOICE" } })).toBe(2);
  });

  it("has no invoice for an order that is not paid, and answers 404 for an unknown order", async () => {
    const admin = await person("ADMIN");
    const { order: o } = await order();
    expect((await get(admin, `/admin/orders/${o.id}/invoice?party=buyer`).expect(409)).body.code).toBe("NOT_PAID");
    await get(admin, "/admin/orders/nope/invoice?party=buyer").expect(404);
    expect(await prisma.adminAction.count({ where: { targetId: o.id, action: "VIEW_INVOICE" } })).toBe(0);
  });
});

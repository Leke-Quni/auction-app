import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { ORDER_ATTENTION_KINDS, ORDER_NOTE_MAX, type OrderAttentionKind } from "@auction/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret, payoutDelayDays } from "../src/config";
import { attentionOf, attentionWhere } from "../src/admin/admin-order-attention";
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
  const noteOrderIds: string[] = [];

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
    await prisma.orderNote.deleteMany({ where: { orderId: { in: noteOrderIds } } });
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

  describe("orders that need attention", () => {
    const HOUR = 3_600_000;
    const ago = (ms: number) => new Date(Date.now() - ms);
    const delay = payoutDelayDays();
    const shipped = { ...paid, shipmentStatus: "IN_TRANSIT", trackingCode: "T", inTransitAt: ago(DAY) };
    class Rollback extends Error {}

    // [what the order looks like, the one kind it should be flagged as (or null)]
    const cases: [string, Record<string, unknown>, OrderAttentionKind | null][] = [
      ["payment due in 10 hours", { payBy: new Date(Date.now() + 10 * HOUR) }, "expiring"],
      ["payment due in 30 hours", { payBy: new Date(Date.now() + 30 * HOUR) }, null],
      ["payment deadline a minute ago", { payBy: ago(60_000) }, "overdue"],
      ["expired order", { status: "EXPIRED", payBy: ago(2 * DAY) }, null],
      ["paid 4 days ago, not shipped", { ...paid, paidAt: ago(4 * DAY) }, "not-shipped"],
      ["paid 1 day ago, not shipped", { ...paid, paidAt: ago(DAY) }, null],
      ["in transit for 8 days", { ...shipped, shippedAt: ago(8 * DAY) }, "not-delivered"],
      ["in transit for 2 days", { ...shipped, shippedAt: ago(2 * DAY) }, null],
      ["label created 8 days ago", { ...shipped, shipmentStatus: "LABEL_CREATED", inTransitAt: null, shippedAt: ago(8 * DAY) }, "not-delivered"],
      [`delivered ${delay + 2} days ago, no payout`, { ...shipped, shipmentStatus: "DELIVERED", shippedAt: ago(9 * DAY), deliveredAt: ago((delay + 2) * DAY) }, "payout-late"],
      [`delivered ${delay} days ago, no payout yet (inside the grace day)`, { ...shipped, shipmentStatus: "DELIVERED", shippedAt: ago(9 * DAY), deliveredAt: ago(delay * DAY) }, null],
    ];

    const list = async (admin: Who, query: string) => (await get(admin, `/admin/orders?${query}`).expect(200)).body.orders as { id: string; attention: string | null }[];

    // The test app's own background jobs (started with it, then every 30 seconds) work on the whole database: they expire an unpaid order
    // past its deadline, move a shipped one along and send emails. So the states they act on are never saved here. This checks the database condition for every
    // kind against the per-order check inside a transaction that is rolled back, where no other connection can see the rows.
    it("agrees between the database condition and the per-order check for every state and every kind", async () => {
      const { listing, buyer, seller } = await order();
      const now = new Date();
      const results: { name: string; kind: string; found: boolean; expected: boolean; attention: string | null; wanted: string | null }[] = [];
      await expect(
        prisma.$transaction(async (tx) => {
          let round = 1;
          for (const [name, over, wanted] of cases) {
            const o = await tx.order.create({
              data: { listingId: listing.id, buyerId: buyer.id, sellerId: seller.id, round: ++round, amountCents: 4500, feeCents: 225, sellerNetCents: 4275, payBy: new Date(Date.now() + DAY), pickupAddress, ...over } as never,
            });
            for (const kind of [...ORDER_ATTENTION_KINDS, "any"] as const) {
              const found = (await tx.order.count({ where: { AND: [{ id: o.id }, attentionWhere(kind, now)] } })) === 1;
              results.push({ name, kind, found, expected: kind === "any" ? wanted !== null : kind === wanted, attention: attentionOf({ ...o, payout: null }, now), wanted });
            }
          }
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
      expect(results).toHaveLength(cases.length * (ORDER_ATTENTION_KINDS.length + 1));
      for (const r of results) {
        expect(r.found, `${r.name} under ${r.kind}`).toBe(r.expected);
        expect(r.attention, `${r.name}: per-order check`).toBe(r.wanted);
      }
      expect(await prisma.order.count({ where: { listingId: listing.id, round: { gt: 1 } } })).toBe(0);
    });

    // These states are left alone by the background jobs: a paid order nobody has shipped, an unpaid order whose reminder is already
    // marked sent (it is not past its deadline), and a delivered order whose seller has no payment account to be paid into.
    it("lists a stuck order with its reason, and filters by it", async () => {
      const admin = await person("ADMIN");
      const quiet = await order({ ...paid, paidAt: ago(4 * DAY) });
      const soon = await order({ payBy: new Date(Date.now() + 10 * HOUR), payReminderSentAt: new Date() });
      const late = await order({ ...shipped, shipmentStatus: "DELIVERED", shippedAt: ago(9 * DAY), deliveredAt: ago((delay + 2) * DAY) });
      const fine = await order({ ...paid, paidAt: ago(DAY) });
      const rows = new Map((await list(admin, `limit=100`)).map((r) => [r.id, r.attention]));
      expect(rows.get(quiet.order.id)).toBe("not-shipped");
      expect(rows.get(soon.order.id)).toBe("expiring");
      expect(rows.get(late.order.id)).toBe("payout-late");
      expect(rows.get(fine.order.id)).toBeNull();

      const only = async (kind: string, id: string) => (await list(admin, `q=${id}&attention=${kind}`)).length;
      expect([await only("not-shipped", quiet.order.id), await only("expiring", quiet.order.id), await only("any", quiet.order.id)]).toEqual([1, 0, 1]);
      expect([await only("expiring", soon.order.id), await only("payout-late", soon.order.id)]).toEqual([1, 0]);
      expect([await only("payout-late", late.order.id), await only("any", fine.order.id)]).toEqual([1, 0]);
    });

    it("does not flag a delivered order whose payout went out", async () => {
      const admin = await person("ADMIN");
      const { seller, order: o } = await order({ ...shipped, shipmentStatus: "DELIVERED", shippedAt: ago(10 * DAY), deliveredAt: ago((delay + 3) * DAY) });
      expect((await list(admin, `q=${o.id}`))[0].attention).toBe("payout-late");
      await prisma.payout.create({ data: { orderId: o.id, sellerId: seller.id, amountCents: 4275, reference: `tr_att_${stamp}` } });
      expect((await list(admin, `q=${o.id}`))[0].attention).toBeNull();
      expect(await list(admin, `q=${o.id}&attention=payout-late`)).toHaveLength(0);
    });

    it("combines with the status filter and the search text, and refuses an unknown kind", async () => {
      const admin = await person("ADMIN");
      const { order: o } = await order({ payBy: new Date(Date.now() + 5 * HOUR), payReminderSentAt: new Date() });
      expect(await list(admin, `q=${o.id}&attention=expiring&status=AWAITING_PAYMENT`)).toHaveLength(1);
      expect(await list(admin, `q=${o.id}&attention=any&status=AWAITING_PAYMENT`)).toHaveLength(1);
      expect(await list(admin, `q=${o.id}&attention=expiring&status=PAID`)).toHaveLength(0);
      expect(await list(admin, `q=nothing-${stamp}&attention=any`)).toHaveLength(0);
      await get(admin, "/admin/orders?attention=sleepy").expect(400);
    });

    it("counts them on the overview", async () => {
      const admin = await person("ADMIN");
      const before = (await get(admin, "/admin/overview").expect(200)).body.ordersNeedingAttention as number;
      await order({ ...paid, paidAt: ago(5 * DAY) });
      await order({ ...paid, paidAt: ago(6 * DAY) });
      await order({ ...paid, paidAt: ago(DAY) });
      const after = (await get(admin, "/admin/overview").expect(200)).body.ordersNeedingAttention as number;
      // Other test files may add or clear orders at the same moment, so at least the two flagged ones; never the third as well.
      expect(after - before).toBeGreaterThanOrEqual(2);
    });
  });

  describe("notes on an order", () => {
    const post = (who: Who, orderId: string, body: unknown) => request(url).post(`/admin/orders/${orderId}/notes`).set(who.auth).send(body as object);

    it("is for admins only", async () => {
      const user = await person();
      const { order: o } = await order();
      noteOrderIds.push(o.id);
      await request(url).post(`/admin/orders/${o.id}/notes`).send({ body: "hi" }).expect(401);
      await post(user, o.id, { body: "hi" }).expect(403);
      expect(await prisma.orderNote.count({ where: { orderId: o.id } })).toBe(0);
    });

    it("saves a note with who wrote it, shows notes oldest first on the order, and writes the audit record", async () => {
      const first = await person("ADMIN");
      const second = await person("ADMIN");
      const { order: o } = await order(paid);
      noteOrderIds.push(o.id);
      const saved = (await post(first, o.id, { body: "  Emailed the seller, waiting for a tracking number.\nSecond line.  " }).expect(201)).body;
      expect(saved).toMatchObject({ body: "Emailed the seller, waiting for a tracking number.\nSecond line." });
      await post(second, o.id, { body: "Seller replied: label goes out Friday." }).expect(201);

      const view = (await get(first, `/admin/orders/${o.id}`).expect(200)).body;
      expect(view.notes.map((n: { body: string; admin: { username: string } }) => [n.admin.username, n.body])).toEqual([
        [first.username, "Emailed the seller, waiting for a tracking number.\nSecond line."],
        ["" + second.username, "Seller replied: label goes out Friday."],
      ]);
      const audit = await prisma.adminAction.findMany({ where: { targetId: o.id, action: "ADD_ORDER_NOTE" }, orderBy: { createdAt: "asc" } });
      expect(audit.map((a) => a.adminId)).toEqual([first.id, second.id]);
      expect(audit[0].reason).toBe(saved.id);
    });

    it("refuses an empty, blank or too long note, and a note on an order that does not exist, saving nothing", async () => {
      const admin = await person("ADMIN");
      const { order: o } = await order();
      noteOrderIds.push(o.id);
      for (const body of [{}, { body: "" }, { body: "   \n " }, { body: 5 }, { body: "x".repeat(ORDER_NOTE_MAX + 1) }]) await post(admin, o.id, body).expect(400);
      expect((await post(admin, o.id, { body: "x".repeat(ORDER_NOTE_MAX) })).status).toBe(201);
      await post(admin, `nope_${stamp}`, { body: "hi" }).expect(404);
      expect(await prisma.orderNote.count({ where: { orderId: o.id } })).toBe(1);
      expect(await prisma.orderNote.count({ where: { orderId: `nope_${stamp}` } })).toBe(0);
      expect(await prisma.adminAction.count({ where: { targetId: `nope_${stamp}` } })).toBe(0);
    });

    it("never reaches the buyer or the seller, and cannot be edited or deleted", async () => {
      const admin = await person("ADMIN");
      const { buyer, seller, order: o } = await order(paid);
      noteOrderIds.push(o.id);
      const note = (await post(admin, o.id, { body: "Secret-internal-remark-for-admins" }).expect(201)).body;
      for (const who of [buyer, seller]) {
        expect(JSON.stringify((await get(who, `/orders/${o.id}`).expect(200)).body)).not.toContain("Secret-internal-remark");
        expect(JSON.stringify((await get(who, "/orders").expect(200)).body)).not.toContain("Secret-internal-remark");
      }
      await request(url).patch(`/admin/orders/${o.id}/notes/${note.id}`).set(admin.auth).send({ body: "changed" }).expect(404);
      await request(url).delete(`/admin/orders/${o.id}/notes/${note.id}`).set(admin.auth).expect(404);
      expect((await prisma.orderNote.findUniqueOrThrow({ where: { id: note.id } })).body).toBe("Secret-internal-remark-for-admins");
    });

    it("shows how many notes an order has in the list", async () => {
      const admin = await person("ADMIN");
      const { order: o } = await order();
      noteOrderIds.push(o.id);
      const count = async () => (await get(admin, `/admin/orders?q=${o.id}`).expect(200)).body.orders[0].noteCount;
      expect(await count()).toBe(0);
      await post(admin, o.id, { body: "one" }).expect(201);
      await post(admin, o.id, { body: "two" }).expect(201);
      expect(await count()).toBe(2);
    });
  });


});

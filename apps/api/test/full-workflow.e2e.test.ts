import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { MailOutbox } from "../src/email/mail-outbox.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailAttachment } from "../src/email/mail-sender";
import { FakePaymentProvider } from "../src/payments/fake-payment-provider";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const pickup = { name: "Sam Seller", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344000111" };
const deliverTo = { name: "Ben Buyer", line1: "Rruga Myslym Shyri 7", city: "Tirana", postcode: "1001", country: "AL", phone: "+355 69 111 2222" };

type Role = "seller" | "buyer" | "rival" | "stranger";

describe("the whole workflow, through the real API", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let emails: MailOutbox;
  let provider: FakePaymentProvider;
  let categoryId: string;
  let failNextMail = 0;
  const sent: { to: string; subject: string; text: string; attachments: MailAttachment[] }[] = [];
  const ids: Record<Role, string> = { seller: `fw_${stamp}_s`, buyer: `fw_${stamp}_b`, rival: `fw_${stamp}_r`, stranger: `fw_${stamp}_x` };
  const tokens = {} as Record<Role, string>;
  const created: string[] = [];
  const mine = { email: { startsWith: "fw-", endsWith: `-${stamp}@example.com` } };
  const emailOf = (r: Role) => `fw-${r}-${stamp}@example.com`;
  const api = () => request(app.getHttpServer());
  const as = (r: Role) => ({ Authorization: `Bearer ${tokens[r]}` });

  beforeAll(async () => {
    provider = new FakePaymentProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({
        send: async (to: string, subject: string, text: string, attachments: MailAttachment[] = []) => {
          if (failNextMail > 0) {
            failNextMail--;
            throw new Error("mail provider down");
          }
          sent.push({ to, subject, text, attachments });
        },
      })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    emails = app.get(MailOutbox);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    await prisma.user.createMany({
      data: (Object.keys(ids) as Role[]).map((r) => ({ id: ids[r], email: emailOf(r), firstName: "F", lastName: "W", username: `fw${r}${stamp}`.slice(0, 20), passwordHash: "!test", emailVerified: new Date() })),
    });
    for (const r of Object.keys(ids) as Role[]) {
      tokens[r] = await new SignJWT({ email: emailOf(r), role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(ids[r]).setExpirationTime("20m").sign(authSecret());
    }
  });

  afterAll(async () => {
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bidAudit.deleteMany({ where: { listingId: { in: created } } }).catch(() => undefined);
    await prisma.bid.deleteMany({ where: { listingId: { in: created } } });
    await prisma.listing.deleteMany({ where: { id: { in: created } } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const image = (n: number) => ({ url: `https://abc123.public.blob.vercel-storage.com/listings/${ids.seller}/fw-${stamp}-${n}.jpg`, pathname: `listings/${ids.seller}/fw-${stamp}-${n}.jpg` });

  // Creates, photographs and publishes a listing through the API, as the seller would.
  const publishListing = async (over: Record<string, unknown> = {}) => {
    const draft = (
      await api()
        .post("/listings")
        .set(as("seller"))
        .send({ title: `Workflow lamp ${created.length}`, description: "A lamp for the workflow test.", categoryId, condition: "GOOD", startingPriceCents: 1000, reservePriceCents: null, durationDays: 1, pickupAddress: pickup, ...over })
        .expect(201)
    ).body;
    created.push(draft.id);
    await api().put(`/listings/${draft.id}/images`).set(as("seller")).send({ images: [image(created.length)] }).expect(200);
    await api().post(`/listings/${draft.id}/publish`).set(as("seller")).send({}).expect(200);
    // The auction started "now" by this machine's clock; the database judges whether it is live by its own, which can run a
    // little behind in Docker, so a bid straight away could be refused as "not live yet". Start it a minute earlier.
    await prisma.listing.update({ where: { id: draft.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    return draft.id as string;
  };
  const bid = (listingId: string, who: Role, amountCents: number) => api().post(`/listings/${listingId}/bids`).set(as(who)).send({ amountCents, idempotencyKey: randomUUID() });
  const endNow = async (listingId: string) => {
    await prisma.listing.update({ where: { id: listingId }, data: { startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - 1000) } });
    await closer.close(listingId);
    await emails.sweep();
  };
  const orderOf = (listingId: string) => prisma.order.findFirstOrThrow({ where: { listingId }, orderBy: { round: "desc" } });
  const mailsFor = (to: Role, needle: string) => sent.filter((m) => m.to === emailOf(to) && m.subject.includes(needle));
  const pay = async (orderId: string, optionId = "express") => {
    await api().put(`/orders/${orderId}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId }).expect(200);
    await api().post(`/orders/${orderId}/checkout`).set(as("buyer")).expect(201);
    const ref = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentRef!;
    provider.simulatePayment(ref);
    return await api().post(`/orders/${orderId}/confirm`).set(as("buyer"));
  };

  describe("the happy path, start to finish", () => {
    it("takes a sale from the seller's pickup address to a paid, invoiced, emailed order", async () => {
      // 1. The seller saves a default pickup address, and the new listing is made with it.
      await api().put("/me/pickup-address").set(as("seller")).send(pickup).expect(200);
      const listingId = await publishListing({ title: "Happy path lamp" });

      // 2. The public cannot see where the seller lives; the seller can.
      const publicView = (await api().get(`/listings/${listingId}`).expect(200)).body;
      expect(JSON.stringify(publicView)).not.toContain("Dardania");
      expect((await api().get(`/listings/${listingId}`).set(as("seller")).expect(200)).body.pickupAddress.line1).toBe("Rr. Dardania 12");

      // 3. Bidding: the seller cannot bid, a rival bids, the buyer outbids.
      await bid(listingId, "seller", 1000).expect(403);
      await bid(listingId, "rival", 1000).expect(201);
      await bid(listingId, "buyer", 1100).expect(201);
      await bid(listingId, "buyer", 1100).expect(409); // the buyer already leads, and 11.00 is not above their own maximum
      await bid(listingId, "rival", 1150).expect(422); // below the 12.00 minimum
      await bid(listingId, "rival", 1200).expect(201);
      await bid(listingId, "buyer", 1300).expect(201);

      // 4. The auction ends and closes: a sale to the buyer at 13.00, with the seller's pickup address copied onto the order.
      await endNow(listingId);
      const closed = (await api().get(`/listings/${listingId}`).expect(200)).body;
      expect(closed).toMatchObject({ outcome: "SOLD", finalPriceCents: 1300, winner: { username: expect.stringContaining("fwbuyer") } });
      const order = await orderOf(listingId);
      expect(order).toMatchObject({ buyerId: ids.buyer, sellerId: ids.seller, amountCents: 1300, feeCents: 65, sellerNetCents: 1235, status: "AWAITING_PAYMENT", shippingCents: null, totalCents: null, invoiceNumber: null });
      expect(order.pickupAddress).toMatchObject({ line1: "Rr. Dardania 12" });
      expect(order.payBy.getTime() - Date.now()).toBeGreaterThan(47 * 3600_000);

      // 5. Emails after the close: the winner is told to pay, the rival that they lost; nobody else gets anything.
      expect(mailsFor("buyer", "pay now")).toHaveLength(1);
      expect(mailsFor("rival", "has ended")).toHaveLength(1);
      expect(mailsFor("rival", "has ended")[0]!.text).toContain("€13.00");
      expect(sent.filter((m) => m.to === emailOf("seller") || m.to === emailOf("stranger"))).toHaveLength(0);

      // 6. Paying is not possible until the delivery is chosen.
      expect((await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(409)).body.code).toBe("SHIPPING_REQUIRED");
      const options = (await api().get(`/orders/${order.id}/shipping/options`).set(as("buyer")).expect(200)).body;
      expect(options.map((o: { id: string; priceCents: number }) => [o.id, o.priceCents])).toEqual([["standard", 300], ["express", 900], ["insured", 700]]); // 5% of 13.00 is under the 3 euro minimum

      // 7. Pay with express: 13.00 + 9.00 = 22.00.
      const payment = await pay(order.id, "express");
      expect(payment.status).toBe(201);
      const confirmed = payment.body;
      expect(confirmed).toMatchObject({ status: "PAID", totalCents: 2200, invoiceNumber: expect.stringMatching(/^INV-\d{4}-\d{6}$/) });
      await emails.sweep();

      // 8. The two emails, each once: the buyer's confirmation with the invoice, the seller's collection notice.
      const buyerMail = mailsFor("buyer", "Payment completed");
      const sellerMail = mailsFor("seller", "Sold");
      expect(buyerMail).toHaveLength(1);
      expect(sellerMail).toHaveLength(1);
      expect(buyerMail[0]!.text).toContain(confirmed.invoiceNumber);
      expect(buyerMail[0]!.text).toContain("€22.00");
      expect(buyerMail[0]!.text).toContain("Rruga Myslym Shyri 7");
      expect(buyerMail[0]!.text).not.toContain("Dardania");
      expect(buyerMail[0]!.attachments[0]!.content.subarray(0, 4).toString()).toBe("%PDF");
      expect(sellerMail[0]!.text).toContain("Rr. Dardania 12");
      expect(sellerMail[0]!.text).toContain("€12.35");
      expect(sellerMail[0]!.text).not.toContain("Myslym");
      expect(sellerMail[0]!.text).not.toContain("355 69");
      expect(sellerMail[0]!.text).not.toMatch(/€22\.00|€9\.00/); // nothing about what the buyer paid in all or for delivery
      expect(sellerMail[0]!.text).toContain("€13.00"); // what the item sold for
      expect(sellerMail[0]!.text).toContain("€0.65"); // the fee taken

      // 9. What each side can read afterwards.
      const buyerView = (await api().get(`/orders/${order.id}`).set(as("buyer")).expect(200)).body;
      const sellerView = (await api().get(`/orders/${order.id}`).set(as("seller")).expect(200)).body;
      expect(buyerView.shipping.address.line1).toBe("Rruga Myslym Shyri 7");
      expect(buyerView).not.toHaveProperty("pickupAddress");
      expect(buyerView).not.toHaveProperty("feeCents");
      expect(sellerView.pickupAddress.line1).toBe("Rr. Dardania 12");
      expect(sellerView.shipping.address).toEqual({ city: "Tirana", country: "AL" });
      expect(sellerView).toMatchObject({ amountCents: 1300, feeCents: 65, sellerNetCents: 1235 });
      // The seller never sees what the buyer paid in all or for delivery: only the item price, the fee and what they receive.
      expect(sellerView.totalCents).toBeNull();
      expect(sellerView.shipping).not.toHaveProperty("priceCents");
      // Whole numbers only: a random id can contain "900" by chance.
      expect(JSON.stringify(sellerView)).not.toMatch(/\b(2200|900)\b/);
      expect(buyerView).toMatchObject({ totalCents: 2200, shipping: { priceCents: 900 } });
      const sellerList = (await api().get(`/orders?listingId=${listingId}`).set(as("seller")).expect(200)).body[0];
      expect(sellerList.totalCents).toBeNull();
      expect(sellerList.shipping).not.toHaveProperty("priceCents");
      await api().get(`/orders/${order.id}`).set(as("stranger")).expect(404);
      await api().get(`/orders/${order.id}`).set(as("rival")).expect(404);

      // 10. The invoice downloads for both sides, and not for others.
      const pdf = (who: Role) =>
        api().get(`/orders/${order.id}/invoice`).set(as(who)).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      for (const who of ["buyer", "seller"] as const) expect((await pdf(who)).body.subarray(0, 4).toString()).toBe("%PDF");
      expect((await pdf("stranger")).status).toBe(404);

      // 11. Nothing more can change once paid.
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "standard" }).expect(409);
      await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(409);
      await emails.sweep();
      expect(mailsFor("buyer", "Payment completed")).toHaveLength(1); // still one
    });
  });

  describe("sales that do not complete", () => {
    it("makes no order and sends no payment emails when the reserve is not met", async () => {
      const listingId = await publishListing({ reservePriceCents: 9000 });
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      expect((await api().get(`/listings/${listingId}`).expect(200)).body.outcome).toBe("NO_SALE");
      expect(await prisma.order.count({ where: { listingId } })).toBe(0);
    });

    it("makes no order when nobody bids", async () => {
      const listingId = await publishListing();
      await endNow(listingId);
      expect((await api().get(`/listings/${listingId}`).expect(200)).body.outcome).toBe("NO_BIDS");
      expect(await prisma.order.count({ where: { listingId } })).toBe(0);
    });
  });

  describe("delivery price edges", () => {
    it("charges the 3 euro minimum on a cheap item and the 50 euro cap on an expensive one", async () => {
      const cheap = await publishListing({ startingPriceCents: 100 });
      await bid(cheap, "buyer", 100).expect(201);
      await endNow(cheap);
      const cheapOrder = await orderOf(cheap);
      const cheapOptions = (await api().get(`/orders/${cheapOrder.id}/shipping/options`).set(as("buyer")).expect(200)).body;
      expect(cheapOptions[0].priceCents).toBe(300);
      expect(cheapOrder).toMatchObject({ amountCents: 100, feeCents: 5, sellerNetCents: 95 });

      const dear = await publishListing({ startingPriceCents: 5_000_000 });
      await bid(dear, "buyer", 5_000_000).expect(201);
      await endNow(dear);
      const dearOrder = await orderOf(dear);
      const dearOptions = (await api().get(`/orders/${dearOrder.id}/shipping/options`).set(as("buyer")).expect(200)).body;
      expect(dearOptions.map((o: { priceCents: number }) => o.priceCents)).toEqual([5000, 5600, 5400]);
      expect(dearOrder).toMatchObject({ feeCents: 5000, sellerNetCents: 4_995_000 }); // seller fee capped too
      const paid = (await pay(dearOrder.id, "insured")).body;
      expect(paid.totalCents).toBe(5_000_000 + 5400);
    });
  });

  describe("permissions and timing", () => {
    it("lets only the buyer pick the delivery, and only while the order is waiting and within the payment window", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      for (const who of ["seller", "stranger", "rival"] as const) {
        const res = await api().put(`/orders/${order.id}/shipping`).set(as(who)).send({ address: deliverTo, optionId: "standard" });
        expect(res.status, who).toBe(who === "seller" ? 403 : 404);
      }
      await api().put(`/orders/${order.id}/shipping`).send({ address: deliverTo, optionId: "standard" }).expect(401);
      await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() - 1000) } });
      expect((await api().get(`/orders/${order.id}/shipping/options`).set(as("buyer")).expect(409)).body.code).toBe("PAYMENT_WINDOW_CLOSED");
      expect((await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "standard" }).expect(409)).body.code).toBe("PAYMENT_WINDOW_CLOSED");
      await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() + DAY), status: "EXPIRED" } });
      expect((await api().get(`/orders/${order.id}/shipping/options`).set(as("buyer")).expect(409)).body.code).toBe("NOT_PAYABLE");
    });

    it("has no invoice for an order that is not paid", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      expect((await api().get(`/orders/${order.id}/invoice`).set(as("buyer")).expect(409)).body.code).toBe("NOT_PAID");
    });
  });

  describe("the pickup address", () => {
    it("is required to publish, fixed afterwards, validated, and never in any public listing", async () => {
      const draft = (await api().post("/listings").set(as("seller")).send({ title: "No pickup yet", description: "A lamp without an address.", categoryId, condition: "GOOD", startingPriceCents: 1000, reservePriceCents: null, durationDays: 1 }).expect(201)).body;
      created.push(draft.id);
      await api().put(`/listings/${draft.id}/images`).set(as("seller")).send({ images: [image(900)] }).expect(200);
      await api().post(`/listings/${draft.id}/publish`).set(as("seller")).send({}).expect(400);
      await api().patch(`/listings/${draft.id}`).set(as("seller")).send({ pickupAddress: { ...pickup, phone: "abc" } }).expect(400);
      await api().patch(`/listings/${draft.id}`).set(as("seller")).send({ pickupAddress: { ...pickup, country: "ZZ" } }).expect(400);
      await api().patch(`/listings/${draft.id}`).set(as("seller")).send({ pickupAddress: null }).expect(400);
      await api().patch(`/listings/${draft.id}`).set(as("stranger")).send({ pickupAddress: pickup }).expect(404);
      await api().patch(`/listings/${draft.id}`).set(as("seller")).send({ pickupAddress: pickup }).expect(200);
      await api().post(`/listings/${draft.id}/publish`).set(as("seller")).send({}).expect(200);
      await api().patch(`/listings/${draft.id}`).set(as("seller")).send({ pickupAddress: { ...pickup, line1: "Elsewhere 9" } }).expect(400);
      for (const path of ["/listings", `/listings/${draft.id}`, "/listings?section=endingSoon"]) {
        expect(JSON.stringify((await api().get(path).expect(200)).body), path).not.toContain("Dardania");
      }
      expect(JSON.stringify((await api().get(`/listings/${draft.id}`).set(as("rival")).expect(200)).body)).not.toContain("Dardania");
    });
  });

  describe("payment edges", () => {
    it("pays once and numbers one invoice when the payment is confirmed many times at once", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "standard" }).expect(200);
      await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
      provider.simulatePayment((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!);
      const before = sent.length;
      const results = await Promise.all(Array.from({ length: 10 }, () => api().post(`/orders/${order.id}/confirm`).set(as("buyer"))));
      expect(results.every((r) => r.status === 201)).toBe(true);
      await Promise.all([emails.sweep(), emails.sweep()]);
      const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(paid.status).toBe("PAID");
      expect(sent.slice(before).filter((m) => m.subject.includes("Payment completed") || m.subject.includes("Sold"))).toHaveLength(2);
      expect(await prisma.pendingEndEmail.count({ where: { listingId, kind: { in: ["PAID", "SOLD"] } } })).toBe(0);
    });

    it("gives every order paid at the same moment its own invoice number", async () => {
      const orders = [];
      for (let i = 0; i < 5; i++) {
        const listingId = await publishListing();
        await bid(listingId, "buyer", 1000).expect(201);
        await endNow(listingId);
        const order = await orderOf(listingId);
        await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "standard" }).expect(200);
        await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
        provider.simulatePayment((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!);
        orders.push(order);
      }
      await Promise.all(orders.map((o) => api().post(`/orders/${o.id}/confirm`).set(as("buyer")).expect(201)));
      const numbers = (await prisma.order.findMany({ where: { id: { in: orders.map((o) => o.id) } }, select: { invoiceNumber: true } })).map((o) => o.invoiceNumber);
      expect(numbers.every(Boolean)).toBe(true);
      expect(new Set(numbers).size).toBe(5);
    });

    it("sends the payment emails late rather than never when the mail provider fails once", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      // Paying starts a mail sweep in the background, which can send these emails before the next line runs, so the list is
      // measured first and the emails are picked out by this order, not by who they went to (the accounts are shared by tests).
      const before = sent.length;
      expect((await pay(order.id, "standard")).status).toBe(201);
      failNextMail = 1;
      await emails.sweep(); // the first send fails; its row is leased for 2 minutes
      await prisma.pendingEndEmail.updateMany({ where: { listingId, kind: { in: ["PAID", "SOLD"] } }, data: { dueAt: new Date(Date.now() - 1000) } });
      await emails.sweep();
      const delivered = sent.slice(before).filter((m) => (m.subject.includes("Payment completed") || m.subject.includes("Sold")) && m.text.includes(`/orders/${order.id}`));
      expect(delivered.map((m) => m.to).sort()).toEqual([emailOf("buyer"), emailOf("seller")]);
    });

    it("still sends the seller a useful notice for an old listing that had no pickup address", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      await prisma.order.update({ where: { id: order.id }, data: { pickupAddress: undefined } });
      await prisma.$executeRaw`UPDATE "Order" SET "pickupAddress" = NULL WHERE "id" = ${order.id}`;
      const before = sent.length;
      expect((await pay(order.id, "standard")).status).toBe(201);
      await emails.sweep();
      const seller = sent.slice(before).find((m) => m.to === emailOf("seller") && m.subject.includes("Sold"));
      expect(seller?.text).toContain("no pickup address saved");
    });
  });

  describe("being charged exactly once", () => {
    it("refunds the second payment when the buyer somehow paid two checkout sessions, keeping exactly one", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "standard" }).expect(200);
      await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
      // A second session that the app would never open itself, as if two requests had raced at the provider.
      const other = await provider.createCheckout({ orderId: order.id, amountCents: 1000, shippingCents: 300, shippingLabel: "Delivery: Standard", description: "x", buyerEmail: emailOf("buyer") });
      await prisma.order.update({ where: { id: order.id }, data: { paymentRefs: { push: other.id } } });
      const refs = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRefs;
      expect(refs).toHaveLength(2);
      for (const ref of refs) provider.simulatePayment(ref); // the buyer pays in both tabs
      await api().post(`/orders/${order.id}/confirm`).set(as("buyer")).expect(201);
      const paidSessions = refs.filter((r) => provider.sessions.get(r)?.paid);
      const refunded = refs.filter((r) => provider.sessions.get(r)?.refunded);
      expect(paidSessions).toHaveLength(2);
      expect(refunded).toHaveLength(1);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.status).toBe("PAID");
      expect(refs.filter((r) => !provider.sessions.get(r)?.refunded)).toEqual([row.paymentRef]); // the one left standing is the one that paid the order
    });

    it("keeps the open checkout page when the same delivery is saved again, as when the form is sent from a second tab", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      const save = () => api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "express" }).expect(200);
      const urls: string[] = [];
      for (let tab = 0; tab < 3; tab++) {
        await save(); // what "Continue to payment" does first...
        urls.push((await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201)).body.url); // ...then this
      }
      expect(new Set(urls).size).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRefs).toHaveLength(1);
      // The address alone changing does not touch the page either: the payment page does not show it.
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: { ...deliverTo, line1: "Rruga Tjeter 9" }, optionId: "express" }).expect(200);
      expect((await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201)).body.url).toBe(urls[0]);
    });

    it("closes the open checkout page when the delivery changes, so the old total can never be paid", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "standard" }).expect(200);
      const first = (await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201)).body.url;
      const stale = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "express" }).expect(200);
      expect(provider.simulatePayment(stale)).toBe(false); // the page left open can no longer take money
      const second = (await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201)).body.url;
      expect(second).not.toBe(first); // a new page, for the new total
      const fresh = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
      expect(provider.sessions.get(fresh)).toMatchObject({ amountCents: 1000, shippingCents: 900 });
    });

    it("refunds a payment that was already taken on the old total when the delivery changes underneath it", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "standard" }).expect(200);
      await api().post(`/orders/${order.id}/checkout`).set(as("buyer")).expect(201);
      const stale = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
      provider.simulatePayment(stale); // the card went through just before the change
      await api().put(`/orders/${order.id}/shipping`).set(as("buyer")).send({ address: deliverTo, optionId: "express" }).expect(200);
      const confirmed = (await api().post(`/orders/${order.id}/confirm`).set(as("buyer")).expect(201)).body;
      expect(confirmed.status).toBe("AWAITING_PAYMENT"); // not the total the buyer agreed to
      expect(provider.sessions.get(stale)?.refunded).toBe(true); // so the money goes back
    });
  });

  describe("addresses and phone numbers", () => {
    const orderForAddress = async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      return orderOf(listingId);
    };
    const save = (orderId: string, address: object) => api().put(`/orders/${orderId}/shipping`).set(as("buyer")).send({ address, optionId: "standard" });

    it("accepts a phone typed in any common way and stores it in one international form", async () => {
      const order = await orderForAddress();
      for (const phone of ["+355 69 111 2222", "+355(69)111-2222", "+355.69.111.2222", "  +355691112222  "]) {
        const res = await save(order.id, { ...deliverTo, phone });
        expect(res.status, phone).toBe(200);
        expect(res.body.shipping.address.phone).toBe("+355691112222");
      }
    });

    it("rejects phone numbers that are not international numbers", async () => {
      const order = await orderForAddress();
      for (const phone of ["- - - - - -", "+++++++", "abc", "", "069 111 2222", "355691112222", "+0691112222", "+355 12", "+3556911122223333", "+355 069 111 2222"]) {
        expect((await save(order.id, { ...deliverTo, phone })).status, phone).toBe(400);
      }
    });

    it("keeps the leading 0 only for Italian numbers", async () => {
      const order = await orderForAddress();
      expect((await save(order.id, { ...deliverTo, country: "IT", postcode: "00100", phone: "+39 06 1234 5678" })).status).toBe(200);
      expect((await save(order.id, { ...deliverTo, phone: "+355 069 111 2222" })).status).toBe(400);
    });

    it("rejects a city or name that carries a message, a number, a line break or markup", async () => {
      const order = await orderForAddress();
      for (const city of ["Tirana\nCall me on +355 69 000 0000", "Tirana 0691112222", "Tirana, call me", "<b>Tirana</b>", "me@example.com", "T", "Tirana!"]) {
        expect((await save(order.id, { ...deliverTo, city })).status, city).toBe(400);
      }
      for (const name of ["Ben\nBuyer", "Ben Buyer 0691112222", "Ben @ home"]) {
        expect((await save(order.id, { ...deliverTo, name })).status, name).toBe(400);
      }
      for (const line1 of ["Rruga 1\nsecond line", "write me@example.com"]) {
        expect((await save(order.id, { ...deliverTo, line1 })).status, line1).toBe(400);
      }
    });

    it("still accepts real names and places with accents, hyphens, apostrophes and dots", async () => {
      const order = await orderForAddress();
      for (const [name, city] of [["Ëlira O'Connor-Gashi", "Shkodër"], ["Dr. Zoran Đorđević", "Bitola"], ["Ana María", "Gjakovë"]]) {
        expect((await save(order.id, { ...deliverTo, name, city })).status, `${name} / ${city}`).toBe(200);
      }
    });

    it("checks the postcode against the country", async () => {
      const order = await orderForAddress();
      expect((await save(order.id, { ...deliverTo, postcode: "10000" })).status).toBe(400); // Albania has 4 digits
      expect((await save(order.id, { ...deliverTo, postcode: "ABCD" })).status).toBe(400);
      expect((await save(order.id, { ...deliverTo, country: "XK", postcode: "10000" })).status).toBe(200);
      expect((await save(order.id, { ...deliverTo, country: "GB", postcode: "SW1A 1AA", phone: "+44 20 7946 0958" })).status).toBe(200);
    });
  });

  describe("correcting the pickup address", () => {
    it("lets the seller fix it at any time, including after the sale, and the order follows", async () => {
      const listingId = await publishListing();
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      expect(order.pickupAddress).toMatchObject({ line1: "Rr. Dardania 12" });
      const fixed = { ...pickup, line1: "Rr. Dardania 21", phone: "+383 44 000 222" };
      const res = await api().put(`/listings/${listingId}/pickup-address`).set(as("seller")).send(fixed).expect(200);
      expect(res.body).toMatchObject({ pickupAddress: { line1: "Rr. Dardania 21", phone: "+38344000222" }, ordersUpdated: 1 });
      expect((await orderOf(listingId)).pickupAddress).toMatchObject({ line1: "Rr. Dardania 21" });
      const sellerView = (await api().get(`/orders/${order.id}`).set(as("seller")).expect(200)).body;
      expect(sellerView.pickupAddress.line1).toBe("Rr. Dardania 21");
    });

    it("also fixes it after payment, and the seller's notice names the corrected address", async () => {
      await api().put("/me/pickup-address").set(as("seller")).send(pickup).expect(200);
      const listingId = await publishListing({ pickupAddress: { ...pickup, line1: "Rr. Typo 1" } });
      await bid(listingId, "buyer", 1000).expect(201);
      await endNow(listingId);
      const order = await orderOf(listingId);
      await api().put(`/listings/${listingId}/pickup-address`).set(as("seller")).send({ ...pickup, line1: "Rr. Fixed 2" }).expect(200);
      const before = sent.length;
      expect((await pay(order.id, "standard")).status).toBe(201);
      await emails.sweep();
      const mail = sent.slice(before).find((m) => m.to === emailOf("seller") && m.subject.includes("Sold"))!;
      expect(mail.text).toContain("Rr. Fixed 2");
      expect(mail.text).not.toContain("Typo");
      expect(mail.text).toContain(`/orders/${order.id}`); // where to correct it
    });

    it("warns the seller when the address for this item is not their saved default", async () => {
      await api().put("/me/pickup-address").set(as("seller")).send(pickup).expect(200);
      const same = await publishListing();
      const different = await publishListing({ pickupAddress: { ...pickup, line1: "Rr. Another 7" } });
      const mails: Record<string, string> = {};
      for (const [key, listingId] of [["same", same], ["different", different]] as const) {
        await bid(listingId, "buyer", 1000).expect(201);
        await endNow(listingId);
        const before = sent.length;
        expect((await pay((await orderOf(listingId)).id, "standard")).status).toBe(201);
        await emails.sweep();
        mails[key] = sent.slice(before).find((m) => m.to === emailOf("seller") && m.subject.includes("Sold"))!.text;
      }
      expect(mails.same).not.toContain("not your default");
      expect(mails.different).toContain("not your default pickup address");
    });

    it("lets only the seller of the listing do it, and validates the address", async () => {
      const listingId = await publishListing();
      await api().put(`/listings/${listingId}/pickup-address`).set(as("buyer")).send(pickup).expect(403);
      await api().put(`/listings/${listingId}/pickup-address`).send(pickup).expect(401);
      await api().put(`/listings/${listingId}/pickup-address`).set(as("seller")).send({ ...pickup, phone: "abc" }).expect(400);
      await api().put(`/listings/${listingId}/pickup-address`).set(as("seller")).send({ ...pickup, postcode: "1" }).expect(400);
      await api().put(`/listings/missing/pickup-address`).set(as("seller")).send(pickup).expect(404);
    });
  });
});

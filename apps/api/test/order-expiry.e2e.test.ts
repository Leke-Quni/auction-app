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
import { AuctionEvents, type AuctionEvent } from "../src/bids/auction-events";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { OrderExpiryService } from "../src/orders/order-expiry.service";
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

describe("orders that are not paid in time", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let expiry: OrderExpiryService;
  let emails: MailOutbox;
  let provider: FakePaymentProvider;
  let categoryId: string;
  let seller: Person;
  const created: string[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];
  const events: AuctionEvent[] = [];
  const api = () => request(app.getHttpServer());
  const as = (p: Person) => ({ Authorization: `Bearer ${p.token}` });

  beforeAll(async () => {
    provider = new FakePaymentProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    expiry = app.get(OrderExpiryService);
    emails = app.get(MailOutbox);
    app.get(AuctionEvents).stream.subscribe((e) => events.push(e));
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "ex-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.strike.deleteMany({ where: { user: mine } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bidAudit.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listingId: { in: created } } });
    await prisma.listing.deleteMany({ where: { id: { in: created } } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return { id: `ex_${stamp}_${n}`, email: `ex-${n}-${stamp}@example.com`, firstName: "Ex", lastName: "Tester", username: `ex${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(rows.map(async (r) => ({ id: r.id, email: r.email, username: r.username, token: await new SignJWT({ email: r.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(r.id).setExpirationTime("10m").sign(authSecret()) })));
  };

  // A sold auction: each [person, cents] is a bid (in order, rising), the last is the winner. Closed, with its first order.
  const sale = async (bids: [Person, number][], over: Record<string, unknown> = {}) => {
    const top = bids[bids.length - 1]!;
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id, title: `Expiry lamp ${++counter}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED",
        startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - 1000), publishedAt: new Date(Date.now() - 4 * DAY),
        currentBidCents: top[1], bidCount: bids.length, highBidderId: top[0].id,
        pickupAddress: { name: "Sam", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344000111" }, ...over,
      },
    });
    created.push(listing.id);
    for (const [who, cents] of bids) await prisma.bid.create({ data: { listingId: listing.id, bidderId: who.id, amountCents: cents, idempotencyKey: randomUUID() } });
    await closer.close(listing.id);
    return { listing, order: await orderOf(listing.id) };
  };
  const orderOf = (listingId: string, round?: number) => prisma.order.findFirstOrThrow({ where: { listingId, ...(round ? { round } : {}) }, orderBy: { round: "desc" } });
  const overdue = (orderId: string) => prisma.order.update({ where: { id: orderId }, data: { payBy: new Date(Date.now() - 1000) } });
  const strikes = (p: Person) => prisma.strike.count({ where: { userId: p.id } });
  const listingOf = (id: string) => prisma.listing.findUniqueOrThrow({ where: { id } });
  const mailsTo = (p: Person, needle: string) => sent.filter((m) => m.to === p.email && m.subject.includes(needle));

  describe("when the buyer does not pay", () => {
    it("expires the order, strikes the buyer and offers the item to the next bidder at their own highest bid", async () => {
      const [a, b, c] = await makePeople(3);
      const { listing, order } = await sale([[c, 1500], [b, 2000], [a, 2300], [b, 2500], [a, 3000]]);
      expect(order).toMatchObject({ buyerId: a.id, amountCents: 3000, round: 1 });
      await overdue(order.id);
      sent.length = 0;
      events.length = 0;
      const result = await expiry.expire(order.id);
      expect(result).toMatchObject({ nextBuyerId: b.id, nextAmountCents: 2500 }); // b's own highest bid, not a's 3000

      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("EXPIRED");
      expect(await strikes(a)).toBe(1);
      const next = await orderOf(listing.id, 2);
      expect(next).toMatchObject({ buyerId: b.id, sellerId: seller.id, amountCents: 2500, feeCents: 125, sellerNetCents: 2375, status: "AWAITING_PAYMENT", round: 2, totalCents: null });
      expect(next.pickupAddress).toMatchObject({ line1: "Rr. Dardania 12" });
      expect(next.payBy.getTime() - Date.now()).toBeGreaterThan(47 * 3600_000);
      // the listing's result follows the sale
      expect(await listingOf(listing.id)).toMatchObject({ outcome: "SOLD", winnerId: b.id, finalPriceCents: 2500 });
      expect(events.find((e) => e.type === "OrderExpired")).toMatchObject({ listingId: listing.id, nextBuyerId: b.id, nextAmountCents: 2500 });

      await emails.sweep();
      const lost = mailsTo(a, "did not pay")[0]!;
      expect(lost.text).toContain("strike 1 of 2");
      expect(mailsTo(seller, "offered to the next bidder")[0]!.text).toContain(b.username);
      const offer = mailsTo(b, "pay now")[0]!;
      expect(offer.text).toContain("did not pay in time");
      expect(offer.text).toContain("€25.00");
      expect(offer.text).toContain(`/orders/${next.id}`);
    });

    it("does nothing for an order that is not yet due, is already paid, or has already expired", async () => {
      const [a, b] = await makePeople(2);
      const waiting = (await sale([[b, 1500], [a, 2000]])).order;
      expect(await expiry.expire(waiting.id)).toBeNull(); // still inside its window
      expect(await strikes(a)).toBe(0);

      const paid = (await sale([[b, 1500], [a, 2000]])).order;
      await prisma.order.update({ where: { id: paid.id }, data: { status: "PAID", payBy: new Date(Date.now() - 1000) } });
      expect(await expiry.expire(paid.id)).toBeNull();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("PAID");

      const again = (await sale([[b, 1500], [a, 2000]])).order;
      await overdue(again.id);
      expect(await expiry.expire(again.id)).not.toBeNull();
      expect(await expiry.expire(again.id)).toBeNull();
    });

    it("counts one strike and makes one new order however many times, and from however many places, it runs at once", async () => {
      const [a, b] = await makePeople(2);
      const { listing, order } = await sale([[b, 1500], [a, 2000]]);
      await overdue(order.id);
      const results = await Promise.all(Array.from({ length: 12 }, () => expiry.expire(order.id)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await strikes(a)).toBe(1);
      expect(await prisma.order.count({ where: { listingId: listing.id } })).toBe(2);
      await emails.sweep();
      expect(mailsTo(a, "did not pay")).toHaveLength(1);
    });
  });

  describe("who the item is offered to", () => {
    it("ends the auction without a sale when the next bid is below the reserve", async () => {
      const [a, b] = await makePeople(2);
      const { listing, order } = await sale([[b, 1200], [a, 3000]], { reservePriceCents: 2000 });
      await overdue(order.id);
      sent.length = 0;
      expect(await expiry.expire(order.id)).toMatchObject({ nextBuyerId: null, nextAmountCents: null });
      expect(await prisma.order.count({ where: { listingId: listing.id } })).toBe(1);
      expect(await listingOf(listing.id)).toMatchObject({ outcome: "NO_SALE", winnerId: null, finalPriceCents: null });
      expect(await strikes(a)).toBe(1);
      await emails.sweep();
      expect(mailsTo(seller, "no sale")[0]!.text).toContain("list the item again");
    });

    it("ends the auction without a sale when there is no other bidder", async () => {
      const [a] = await makePeople(1);
      const { listing, order } = await sale([[a, 2000]]);
      await overdue(order.id);
      expect(await expiry.expire(order.id)).toMatchObject({ nextBuyerId: null });
      expect(await listingOf(listing.id)).toMatchObject({ outcome: "NO_SALE", winnerId: null });
    });

    it("offers it on again when the next bidder does not pay either, never to someone already offered, until no bid is left", async () => {
      const [a, b, c] = await makePeople(3);
      const { listing, order } = await sale([[c, 1500], [b, 2000], [a, 3000]]);
      await overdue(order.id);
      expect(await expiry.expire(order.id)).toMatchObject({ nextBuyerId: b.id, nextAmountCents: 2000 });
      await overdue((await orderOf(listing.id, 2)).id);
      expect(await expiry.expire((await orderOf(listing.id, 2)).id)).toMatchObject({ nextBuyerId: c.id, nextAmountCents: 1500 });
      expect(await listingOf(listing.id)).toMatchObject({ outcome: "SOLD", winnerId: c.id, finalPriceCents: 1500 });
      await overdue((await orderOf(listing.id, 3)).id);
      expect(await expiry.expire((await orderOf(listing.id, 3)).id)).toMatchObject({ nextBuyerId: null }); // a is not offered it again
      expect(await listingOf(listing.id)).toMatchObject({ outcome: "NO_SALE", winnerId: null, finalPriceCents: null });
      expect((await prisma.order.findMany({ where: { listingId: listing.id }, orderBy: { round: "asc" } })).map((o) => [o.round, o.buyerId, o.status])).toEqual([
        [1, a.id, "EXPIRED"], [2, b.id, "EXPIRED"], [3, c.id, "EXPIRED"],
      ]);
      expect([await strikes(a), await strikes(b), await strikes(c)]).toEqual([1, 1, 1]);
    });

    it("offers it to at most three buyers in all, then ends without a sale and tells the seller why", async () => {
      const [a, b, c, d] = await makePeople(4);
      const { listing, order } = await sale([[d, 1000], [c, 1500], [b, 2000], [a, 3000]]);
      await overdue(order.id);
      await expiry.expire(order.id); // a -> b
      await overdue((await orderOf(listing.id, 2)).id);
      await expiry.expire((await orderOf(listing.id, 2)).id); // b -> c
      // real rounds are two days apart: let the notices of the earlier rounds go out before the last one expires
      for (let i = 0; i < 50 && (await prisma.pendingEndEmail.count({ where: { listingId: listing.id } })) > 0; i++) {
        await emails.sweep();
        await new Promise((r) => setTimeout(r, 100));
      }
      await overdue((await orderOf(listing.id, 3)).id);
      expect(await expiry.expire((await orderOf(listing.id, 3)).id)).toMatchObject({ nextBuyerId: null, nextAmountCents: null }); // d has a bid, but three have been offered
      expect(await prisma.order.count({ where: { listingId: listing.id } })).toBe(3);
      expect(await prisma.order.count({ where: { listingId: listing.id, buyerId: d.id } })).toBe(0);
      expect(await listingOf(listing.id)).toMatchObject({ outcome: "NO_SALE", winnerId: null, finalPriceCents: null });
      expect(await strikes(d)).toBe(0);
      // a sweep already under way makes ours return early, so wait for the email rather than assume it is there
      const noSale = () => sent.filter((m) => m.to === seller.email && m.subject.includes("no sale") && m.subject.includes(listing.title)).at(-1);
      for (let i = 0; i < 50 && !noSale(); i++) {
        await emails.sweep();
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(noSale()!.text).toContain("offered to 3 buyers and none of them paid");
    });

    it("skips a banned bidder", async () => {
      const [a, b, c] = await makePeople(3);
      await prisma.user.update({ where: { id: b.id }, data: { bannedAt: new Date(), banReason: "test" } });
      const { listing, order } = await sale([[c, 1500], [b, 2000], [a, 3000]]);
      await overdue(order.id);
      expect(await expiry.expire(order.id)).toMatchObject({ nextBuyerId: c.id, nextAmountCents: 1500 });
      expect(await prisma.order.count({ where: { listingId: listing.id, buyerId: b.id } })).toBe(0);
    });

    it("skips a bidder who is already blocked from bidding", async () => {
      const [a, b, c] = await makePeople(3);
      for (let i = 0; i < 2; i++) await prisma.strike.create({ data: { userId: b.id, listingId: `old-${i}`, orderId: `old-${stamp}-${b.id}-${i}` } });
      const { listing, order } = await sale([[c, 1500], [b, 2000], [a, 3000]]);
      await overdue(order.id);
      expect(await expiry.expire(order.id)).toMatchObject({ nextBuyerId: c.id, nextAmountCents: 1500 });
      expect(await prisma.order.count({ where: { listingId: listing.id, buyerId: b.id } })).toBe(0);
    });
  });

  describe("payments around the deadline", () => {
    it("does not strike a buyer whose payment was taken but not yet reported", async () => {
      const [a, b] = await makePeople(2);
      const { order } = await sale([[b, 1500], [a, 2000]]);
      await prisma.order.update({ where: { id: order.id }, data: { shippingAddress: { name: "Ann", line1: "Rr 1", city: "Tirana", postcode: "1001", country: "AL", phone: "+355691112222" }, shippingOption: { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 }, shippingCents: 300, totalCents: 2300 } });
      const checkout = await api().post(`/orders/${order.id}/checkout`).set(as(a)).expect(201);
      expect(checkout.body.url).toBeTruthy();
      provider.simulatePayment((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!); // card went through; nobody told us yet
      await overdue(order.id);
      expect(await expiry.expire(order.id)).toBeNull();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
      expect(await strikes(a)).toBe(0);
    });

    it("waits, rather than striking, when the payment provider cannot be asked", async () => {
      const [a, b] = await makePeople(2);
      const { order } = await sale([[b, 1500], [a, 2000]]);
      await prisma.order.update({ where: { id: order.id }, data: { paymentRef: "cs_down", paymentRefs: ["cs_down"] } });
      await overdue(order.id);
      const real = provider.confirm.bind(provider);
      provider.confirm = async () => { throw new Error("provider down"); };
      try {
        await expect(expiry.expire(order.id)).rejects.toThrow("provider down"); // the sweep backs off and retries later
      } finally {
        provider.confirm = real;
      }
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("AWAITING_PAYMENT");
      expect(await strikes(a)).toBe(0);
      expect(await expiry.expire(order.id)).not.toBeNull(); // back up: it expires normally
    });

    it("expires anyway when the provider still cannot be asked a day after the deadline", async () => {
      const [a, b] = await makePeople(2);
      const { order } = await sale([[b, 1500], [a, 2000]]);
      await prisma.order.update({ where: { id: order.id }, data: { paymentRef: "cs_gone", paymentRefs: ["cs_gone"], payBy: new Date(Date.now() - 25 * 3600_000) } });
      const real = provider.confirm.bind(provider);
      provider.confirm = async () => { throw new Error("no such session"); };
      try {
        expect(await expiry.expire(order.id)).not.toBeNull();
      } finally {
        provider.confirm = real;
      }
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("EXPIRED");
      expect(await strikes(a)).toBe(1);
    });

    it("tells the seller about every round, even if an earlier notice has not gone out yet", async () => {
      const [a, b] = await makePeople(2);
      const { listing, order } = await sale([[b, 1500], [a, 2000]]);
      // a notice from an earlier round that is still waiting (and has already failed twice)
      await prisma.pendingEndEmail.create({ data: { userId: seller.id, listingId: listing.id, kind: "NOT_PAID", attempts: 2, dueAt: new Date(Date.now() + 3600_000) } });
      await overdue(order.id);
      await expiry.expire(order.id);
      const waiting = await prisma.pendingEndEmail.findMany({ where: { listingId: listing.id, userId: seller.id, kind: "NOT_PAID" } });
      expect(waiting).toHaveLength(1); // not a second row, not dropped
      expect(waiting[0]).toMatchObject({ attempts: 0 });
      expect(waiting[0]!.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("expires nothing, and strikes nobody, while a checkout page cannot be closed", async () => {
      const [a, b] = await makePeople(2);
      const { order } = await sale([[b, 1500], [a, 2000]]);
      await prisma.order.update({ where: { id: order.id }, data: { shippingAddress: { name: "Ann", line1: "Rr 1", city: "Tirana", postcode: "1001", country: "AL", phone: "+355691112222" }, shippingOption: { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 }, shippingCents: 300, totalCents: 2300 } });
      await api().post(`/orders/${order.id}/checkout`).set(as(a)).expect(201);
      const ref = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
      await overdue(order.id);
      const real = provider.expireCheckout.bind(provider);
      provider.expireCheckout = async () => { throw new Error("provider down"); };
      try {
        await expect(expiry.expire(order.id)).rejects.toThrow("provider down");
      } finally {
        provider.expireCheckout = real;
      }
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("AWAITING_PAYMENT");
      expect(await strikes(a)).toBe(0);
      expect(await expiry.expire(order.id)).not.toBeNull(); // once it can be closed, the order expires and the page is shut
      expect(provider.simulatePayment(ref)).toBe(false);
    });

    it("words a delayed notice with the strike count of its own order, not of a later one", async () => {
      const [a, b] = await makePeople(2);
      const first = await sale([[b, 1500], [a, 2000]]);
      const second = await sale([[b, 1500], [a, 2000]]);
      await overdue(first.order.id);
      await expiry.expire(first.order.id);
      await overdue(second.order.id);
      await expiry.expire(second.order.id); // a is now at two strikes
      // the first notice is sent again late, as after a mail outage
      await prisma.pendingEndEmail.upsert({
        where: { userId_listingId_kind: { userId: a.id, listingId: first.listing.id, kind: "EXPIRED" } },
        create: { userId: a.id, listingId: first.listing.id, kind: "EXPIRED" },
        update: { dueAt: new Date(), attempts: 0 },
      });
      await emails.sweep();
      const notice = (title: string) => sent.filter((m) => m.to === a.email && m.subject.includes(title)).at(-1)!;
      expect(notice(first.listing.title).text).toContain("strike 1 of 2");
      expect(notice(second.listing.title).text).toContain("strike 2");
    });

    it("closes a checkout page left open, so the expired order cannot be paid on it", async () => {
      const [a, b] = await makePeople(2);
      const { order } = await sale([[b, 1500], [a, 2000]]);
      await prisma.order.update({ where: { id: order.id }, data: { shippingAddress: { name: "Ann", line1: "Rr 1", city: "Tirana", postcode: "1001", country: "AL", phone: "+355691112222" }, shippingOption: { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 }, shippingCents: 300, totalCents: 2300 } });
      await api().post(`/orders/${order.id}/checkout`).set(as(a)).expect(201);
      const ref = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
      await overdue(order.id);
      expect(await expiry.expire(order.id)).not.toBeNull();
      expect(provider.simulatePayment(ref)).toBe(false);
      await api().post(`/orders/${order.id}/checkout`).set(as(a)).expect(409); // and no new page
    });
  });

  describe("the sweep", () => {
    it("expires every overdue order it finds and leaves the rest", async () => {
      const [a, b] = await makePeople(2);
      const due1 = (await sale([[b, 1500], [a, 2000]])).order;
      const due2 = (await sale([[b, 1500], [a, 2000]])).order;
      const waiting = (await sale([[b, 1500], [a, 2000]])).order;
      await overdue(due1.id);
      await overdue(due2.id);
      expect(await expiry.sweep()).toBeGreaterThanOrEqual(2);
      for (const o of [due1, due2]) expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("EXPIRED");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("AWAITING_PAYMENT");
    });

    it("leaves an order alone for a while after the provider could not be asked about it, and does not strike meanwhile", async () => {
      const [a, b] = await makePeople(2);
      const { order } = await sale([[b, 1500], [a, 2000]]);
      await prisma.order.update({ where: { id: order.id }, data: { paymentRef: "cs_flaky", paymentRefs: ["cs_flaky"] } });
      await overdue(order.id);
      let asked = 0;
      const real = provider.confirm.bind(provider);
      provider.confirm = async (ref: string) => {
        if (ref === "cs_flaky") {
          asked++;
          throw new Error("provider down");
        }
        return real(ref);
      };
      try {
        await expiry.sweep();
        await expiry.sweep();
      } finally {
        provider.confirm = real;
      }
      expect(asked).toBe(1); // the second sweep skipped it
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("AWAITING_PAYMENT");
      expect(await strikes(a)).toBe(0);
    });

    it("lists a listing's orders with the newest round first", async () => {
      const [a, b] = await makePeople(2);
      const { listing, order } = await sale([[b, 1500], [a, 2000]]);
      await overdue(order.id);
      await expiry.expire(order.id);
      const res = await api().get(`/orders?listingId=${listing.id}`).set(as(seller)).expect(200);
      expect(res.body.map((o: { buyer: { id: string } }) => o.buyer.id)).toEqual([b.id, a.id]); // round 2 (b), then round 1 (a)
    });
  });

  describe("two strikes block bidding", () => {
    const live = async () => {
      const listing = await prisma.listing.create({
        data: { sellerId: seller.id, title: `Live ${++counter}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date(Date.now() - DAY) },
      });
      created.push(listing.id);
      return listing;
    };
    const strike = (p: Person, n: number) => prisma.strike.create({ data: { userId: p.id, listingId: `strike-${n}`, orderId: `strike-${stamp}-${p.id}-${n}` } });
    const bid = (listingId: string, p: Person, cents: number) => api().post(`/listings/${listingId}/bids`).set(as(p)).send({ amountCents: cents, idempotencyKey: randomUUID() });

    it("lets a bidder with one strike bid, and refuses one with two", async () => {
      const [x, y] = await makePeople(2);
      const listing = await live();
      await strike(x, 1);
      await bid(listing.id, x, 1000).expect(201);
      await strike(y, 1);
      await strike(y, 2);
      const refused = await bid(listing.id, y, 1100).expect(403);
      expect(refused.body).toMatchObject({ code: "BLOCKED", message: expect.stringContaining("did not pay") });
      expect(await prisma.bid.count({ where: { listingId: listing.id, bidderId: y.id } })).toBe(0);
      expect(await prisma.bidAudit.findFirst({ where: { listingId: listing.id, userId: y.id, outcome: { not: "ACCEPTED" } } })).toMatchObject({ reason: "BLOCKED" });
    });

    it("tells a signed-in viewer on the listing that they are blocked, and nobody else", async () => {
      const [x, y] = await makePeople(2);
      const listing = await live();
      await strike(y, 1);
      await strike(y, 2);
      expect((await api().get(`/listings/${listing.id}`).set(as(y)).expect(200)).body.viewerBlocked).toBe(true);
      expect((await api().get(`/listings/${listing.id}`).set(as(x)).expect(200)).body.viewerBlocked).toBe(false);
      expect((await api().get(`/listings/${listing.id}`).expect(200)).body).not.toHaveProperty("viewerBlocked");
    });

    it("blocks a buyer for good after a second missed payment, through the whole flow", async () => {
      const [a, b] = await makePeople(2);
      for (let i = 0; i < 2; i++) {
        const { order } = await sale([[b, 1500], [a, 2000]]);
        await overdue(order.id);
        await expiry.expire(order.id);
      }
      expect(await strikes(a)).toBe(2);
      const listing = await live();
      await bid(listing.id, a, 1000).expect(403);
      await bid(listing.id, b, 1000).expect(201); // b only lost: no strike
    });
  });
});

import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { MailOutbox } from "../src/email/mail-outbox.service";
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

describe("orders", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let emails: MailOutbox;
  let provider: FakePaymentProvider;
  let categoryId: string;
  let seller: Person;
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
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "ord-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return { id: `ord_${stamp}_${n}`, email: `ord-${n}-${stamp}@example.com`, firstName: "Ord", lastName: "Tester", username: `or${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        email: r.email,
        username: r.username,
        token: await new SignJWT({ email: r.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(r.id).setExpirationTime("10m").sign(authSecret()),
      })),
    );
  };

  // An ended auction whose high bidder is `winner` at `cents`, already closed.
  const closedAuction = async (winner: Person, cents = 3150, over: Record<string, unknown> = {}) => {
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: `Order test ${counter}`,
        description: "A listing for the order tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - 4 * DAY),
        endsAt: new Date(Date.now() - 1000),
        publishedAt: new Date(Date.now() - 4 * DAY),
        currentBidCents: cents,
        bidCount: 1,
        highBidderId: winner.id,
        ...over,
      },
    });
    created.push(listing.id);
    await prisma.bid.create({ data: { listingId: listing.id, bidderId: winner.id, amountCents: cents, idempotencyKey: `k-${listing.id}` } });
    await closer.close(listing.id);
    return listing;
  };

  const address = { name: "Ada Buyer", line1: "Rr. Nene Tereza 1", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344111222" };
  const option = { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 };
  const withDelivery = (amountCents: number) => ({ shippingAddress: address, shippingOption: option, shippingCents: 300, totalCents: amountCents + 300 });

  // The same, when it ended in a sale: with its order.
  const sale = async (winner: Person, cents = 3150) => {
    const listing = await closedAuction(winner, cents);
    const found = await prisma.order.findFirstOrThrow({ where: { listingId: listing.id } });
    // These tests are about paying, so the delivery is already chosen; the shipping tests start without it.
    const order = await prisma.order.update({ where: { id: found.id }, data: withDelivery(found.amountCents) });
    return { listing, order };
  };

  describe("when an auction is won", () => {
    it("makes one order for the winner with the 5% fee, due in 48 hours, however often the auction is closed", async () => {
      const [buyer] = await makePeople(1);
      const before = Date.now();
      const { listing, order } = await sale(buyer);
      await Promise.all(Array.from({ length: 20 }, () => closer.close(listing.id)));
      expect(await prisma.order.count({ where: { listingId: listing.id } })).toBe(1);
      expect(order).toMatchObject({ buyerId: buyer.id, sellerId: seller.id, amountCents: 3150, feeCents: 158, sellerNetCents: 2992, status: "AWAITING_PAYMENT", round: 1, paidAt: null });
      expect(order.payBy.getTime()).toBeGreaterThanOrEqual(before + 48 * 3600_000);
      expect(order.payBy.getTime()).toBeLessThanOrEqual(Date.now() + 48 * 3600_000);
    });

    it("counts the payment window from the moment the database closed the auction", async () => {
      const [buyer] = await makePeople(1);
      const { listing, order } = await sale(buyer);
      const { closedAt } = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id }, select: { closedAt: true } });
      expect(order.payBy.getTime()).toBe(closedAt!.getTime() + 48 * 3600_000);
    });

    it("makes no order when the reserve was not met or there were no bids", async () => {
      const [buyer] = await makePeople(1);
      const unmet = await closedAuction(buyer, 1000, { reservePriceCents: 5000 });
      expect(await prisma.order.count({ where: { listingId: unmet.id } })).toBe(0);
      const noBids = await closedAuction(buyer, 1000, { currentBidCents: null, bidCount: 0, highBidderId: null });
      expect(await prisma.order.count({ where: { listingId: noBids.id } })).toBe(0);
    });

    it("emails the winner the amount, the deadline and the pay link, once", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);
      await emails.sweep();
      await emails.sweep();
      const got = sent.filter((m) => m.text.includes(`/orders/${order.id}`));
      expect(got).toHaveLength(1);
      expect(got[0].to).toBe(buyer.email);
      expect(got[0].subject).toContain("pay now");
      expect(got[0].text).toContain("with a bid of €31.50");
      expect(got[0].text).toContain(`${order.payBy.toISOString().slice(0, 16).replace("T", " ")} UTC`);
      expect(got[0].text).toContain(`/orders/${order.id}`);
    });
  });

  describe("who can see an order", () => {
    it("shows the buyer the price and the seller the fee and their share, and hides it from everyone else", async () => {
      const [buyer, stranger] = await makePeople(2);
      const { order } = await sale(buyer);
      const asBuyer = (await api().get(`/orders/${order.id}`).set(as(buyer)).expect(200)).body;
      expect(asBuyer).toMatchObject({ id: order.id, amountCents: 3150, status: "AWAITING_PAYMENT", viewer: "buyer", buyer: { id: buyer.id }, seller: { id: seller.id } });
      expect(asBuyer).not.toHaveProperty("feeCents");
      expect(asBuyer).not.toHaveProperty("sellerNetCents");
      const asSeller = (await api().get(`/orders/${order.id}`).set(as(seller)).expect(200)).body;
      expect(asSeller).toMatchObject({ viewer: "seller", feeCents: 158, sellerNetCents: 2992 });
      await api().get(`/orders/${order.id}`).set(as(stranger)).expect(404);
      await api().get(`/orders/${order.id}`).expect(401);
    });

    it("lists a person's own orders, and only those, optionally for one listing", async () => {
      const [buyer, other] = await makePeople(2);
      const mine = await sale(buyer);
      await sale(other);
      const all = (await api().get("/orders").set(as(buyer)).expect(200)).body as { id: string }[];
      expect(all.map((o) => o.id)).toEqual([mine.order.id]);
      const one = (await api().get(`/orders?listingId=${mine.listing.id}`).set(as(buyer)).expect(200)).body as { id: string }[];
      expect(one).toHaveLength(1);
      expect((await api().get(`/orders?listingId=${mine.listing.id}`).set(as(other)).expect(200)).body).toEqual([]);
    });
  });

  describe("paying", () => {
    it("takes the buyer to the provider's checkout, and marks the order paid once the provider says so", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);

      const { url } = (await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201)).body;
      const ref = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
      expect(url).toContain(`/orders/${order.id}/checkout?session=${ref}`);
      expect(provider.sessions.get(ref)).toMatchObject({ orderId: order.id, amountCents: 3150, buyerEmail: buyer.email, paid: false });

      // Not paid yet: confirming changes nothing.
      expect((await api().post(`/orders/${order.id}/confirm`).set(as(buyer)).expect(201)).body.status).toBe("AWAITING_PAYMENT");

      await api().post(`/orders/${order.id}/test-pay`).set(as(buyer)).expect(201);
      const paid = (await api().post(`/orders/${order.id}/confirm`).set(as(buyer)).expect(201)).body;
      expect(paid).toMatchObject({ status: "PAID" });
      expect(paid.paidAt).toBeTruthy();

      const paidAt = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt;
      await api().post(`/orders/${order.id}/confirm`).set(as(buyer)).expect(201); // again: nothing changes
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt).toEqual(paidAt);
    });

    it("removes the winner's saved pay-now notification once the order is paid", async () => {
      const [buyer] = await makePeople(1);
      const { listing, order } = await sale(buyer);
      // Closing the auction saved it (a moment after the close, since the notice is sent from the close event).
      const saved = () => prisma.notification.count({ where: { userId: buyer.id, key: `won:${listing.id}` } });
      for (let i = 0; i < 40 && (await saved()) === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await saved()).toBe(1);
      await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201);
      await api().post(`/orders/${order.id}/test-pay`).set(as(buyer)).expect(201);
      await api().post(`/orders/${order.id}/confirm`).set(as(buyer)).expect(201);
      expect(await prisma.notification.count({ where: { userId: buyer.id, key: `won:${listing.id}` } })).toBe(0);
    });

    it("lets only the buyer pay, and only while the order is waiting and the time has not run out", async () => {
      const [buyer, stranger] = await makePeople(2);
      const { order } = await sale(buyer);
      expect((await api().post(`/orders/${order.id}/checkout`).set(as(seller)).expect(403)).body.code).toBe("NOT_BUYER");
      await api().post(`/orders/${order.id}/checkout`).set(as(stranger)).expect(404);
      await api().post(`/orders/${order.id}/confirm`).set(as(seller)).expect(403);
      await api().post(`/orders/${order.id}/test-pay`).set(as(stranger)).expect(404);

      await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() - 1000) } });
      expect((await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(409)).body.code).toBe("PAYMENT_WINDOW_CLOSED");

      await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() + DAY), status: "PAID" } });
      expect((await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(409)).body.code).toBe("NOT_PAYABLE");
    });

    it("sends a buyer who starts a payment again to the page that is already open, so there is only one session", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);
      const first = (await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201)).body.url;
      const second = (await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201)).body.url;
      expect(second).toBe(first);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.paymentRefs).toHaveLength(1);
      await api().post(`/orders/${order.id}/test-pay`).set(as(buyer)).expect(201);
      expect((await api().post(`/orders/${order.id}/confirm`).set(as(buyer)).expect(201)).body.status).toBe("PAID");
    });

    it("opens only one session when several checkouts are asked for at the same moment", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);
      const results = await Promise.all(Array.from({ length: 8 }, () => api().post(`/orders/${order.id}/checkout`).set(as(buyer))));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.url)).size).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRefs).toHaveLength(1);
    });

    it("closes the page it opened when saving it on the order fails, and the buyer can start again", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);
      // A real database failure, for this one order only: saving the session id on it is refused.
      const trigger = `refuse_save_${order.id.replace(/[^a-z0-9]/gi, "_")}`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'database went away'; END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON "Order" FOR EACH ROW WHEN (NEW."id" = '${order.id}') EXECUTE FUNCTION ${trigger}()`);
      const sessionsBefore = provider.sessions.size;
      try {
        await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(500);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "Order"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`);
      }

      const unsaved = [...provider.sessions.values()].slice(sessionsBefore);
      expect(unsaved).toHaveLength(1);
      expect(unsaved[0].expired).toBe(true);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRefs).toEqual([]);

      await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRefs).toHaveLength(1);
    });

    it("opens a fresh session once the open one has expired or been closed", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);
      await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201);
      const first = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentRef!;
      await provider.expireCheckout(first);
      await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.paymentRefs).toHaveLength(2);
      expect(row.paymentRef).not.toBe(first);
    });

    it("accepts a payment that lands after the deadline while the order is still waiting, but not on an expired order", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);
      await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201);
      await api().post(`/orders/${order.id}/test-pay`).set(as(buyer)).expect(201);
      await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() - 1000) } });
      expect((await api().post(`/orders/${order.id}/confirm`).set(as(buyer)).expect(201)).body.status).toBe("PAID");

      const second = await sale(buyer);
      await api().post(`/orders/${second.order.id}/checkout`).set(as(buyer)).expect(201);
      await api().post(`/orders/${second.order.id}/test-pay`).set(as(buyer)).expect(201);
      await prisma.order.update({ where: { id: second.order.id }, data: { status: "EXPIRED" } });
      expect((await api().post(`/orders/${second.order.id}/confirm`).set(as(buyer)).expect(201)).body.status).toBe("EXPIRED");
      // The money was taken for an order that is no longer on offer, so it is given back.
      const ref = (await prisma.order.findUniqueOrThrow({ where: { id: second.order.id } })).paymentRef!;
      expect(provider.sessions.get(ref)?.refunded).toBe(true);
    });

    it("offers test payments only on a local or test machine", async () => {
      const [buyer] = await makePeople(1);
      const { order } = await sale(buyer);
      await api().post(`/orders/${order.id}/checkout`).set(as(buyer)).expect(201);
      const before = process.env.NODE_ENV;
      try {
        for (const env of ["production", "staging", "preview"]) {
          process.env.NODE_ENV = env;
          await api().post(`/orders/${order.id}/test-pay`).set(as(buyer)).expect(404);
        }
        delete process.env.NODE_ENV;
        await api().post(`/orders/${order.id}/test-pay`).set(as(buyer)).expect(201);
      } finally {
        process.env.NODE_ENV = before;
      }
    });
  });

  describe("bad requests", () => {
    it("answers 400, not 500, for a repeated listingId filter", async () => {
      const [buyer] = await makePeople(1);
      await api().get("/orders?listingId=a&listingId=b").set(as(buyer)).expect(400);
    });
  });

  describe("closing and emailing under failure", () => {
    const unclosed = async () => {
      const listing = await prisma.listing.create({
        data: {
          sellerId: seller.id,
          title: `Unclosed ${counter}`,
          description: "Ended but not closed.",
          categoryId,
          condition: "GOOD",
          startingPriceCents: 1000,
          durationDays: 3,
          status: "PUBLISHED",
          // Long ago, so these come first in the sweep however many other ended listings the database holds.
          startsAt: new Date("2000-01-01T00:00:00Z"),
          endsAt: new Date("2000-01-04T00:00:00Z"),
          publishedAt: new Date("2000-01-01T00:00:00Z"),
        },
      });
      created.push(listing.id);
      return listing;
    };

    it("does not try a listing that failed to close again on the next sweeps, and still closes the others", async () => {
      const broken = await unclosed();
      const healthy = await unclosed();
      const real = closer.close.bind(closer);
      const spy = vi.spyOn(closer, "close").mockImplementation(async (id: string) => {
        if (id === broken.id) throw new Error("boom");
        return real(id);
      });
      try {
        await closer.sweep();
        await closer.sweep();
        await closer.sweep();
        expect(spy.mock.calls.filter(([id]) => id === broken.id)).toHaveLength(1);
        expect((await prisma.listing.findUniqueOrThrow({ where: { id: healthy.id } })).closedAt).not.toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it("keeps an auction-ended email whose auction result is not saved yet, to try again", async () => {
      const [buyer] = await makePeople(1);
      const listing = await unclosed();
      await prisma.pendingEndEmail.create({ data: { userId: buyer.id, listingId: listing.id, kind: "WON", dueAt: new Date("2000-01-01T00:00:00Z") } });
      await emails.sweep();
      const row = await prisma.pendingEndEmail.findFirst({ where: { listingId: listing.id } });
      expect(row).not.toBeNull();
      expect(row!.attempts).toBe(1);
      expect(sent.some((m) => m.to === buyer.email)).toBe(false);
    });
  });
});

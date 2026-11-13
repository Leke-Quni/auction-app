import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SOCKET_EVENTS, type ExtendedNotice, type OutbidNotice } from "@auction/shared";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { OrderExpiryService } from "../src/orders/order-expiry.service";
import { MailOutbox } from "../src/email/mail-outbox.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { NotificationsService } from "../src/realtime/notifications.service";
import { RealtimeAdapter } from "../src/realtime/realtime.adapter";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;

interface Person {
  id: string;
  email: string;
  token: string;
}

describe("bid notifications", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let categoryId: string;
  let seller: Person;
  let counter = 0;
  const sent: { to: string; subject: string; text: string }[] = [];
  let mailFails = false;
  const sockets: Socket[] = [];

  const mail: MailSender = {
    async send(to, subject, text) {
      if (mailFails) throw new Error("mail is down");
      sent.push({ to, subject, text });
    },
  };

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return {
        id: `nt_${stamp}_${n}`,
        email: `nt-${n}-${stamp}@example.com`,
        firstName: "No",
        lastName: "Tice",
        username: `nt${n}x${stamp}`,
        passwordHash: "!test",
        emailVerified: new Date(),
      };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        email: row.email,
        token: await new SignJWT({ email: row.email, role: "USER" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(row.id)
          .setExpirationTime("10m")
          .sign(authSecret()),
      })),
    );
  };

  const makeListing = (over: Record<string, unknown> = {}) =>
    prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Notice test listing",
        description: "A listing for the notification tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 2 * DAY),
        publishedAt: new Date(Date.now() - DAY),
        ...over,
      },
    });

  const open = async (person?: Person) => {
    const socket = connect(url, { auth: person ? { token: person.token } : {}, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    // Joining the private room happens just after connecting.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return socket;
  };

  const collect = (socket: Socket, event: string) => {
    const got: unknown[] = [];
    socket.on(event, (payload) => got.push(payload));
    return got;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
  // Makes every waiting outbid email of this test run due, then sends what is due, as the sweeper would.
  // Only the rows made by the current test, so one test's leftovers cannot be sent by another.
  let testStart = new Date();
  beforeEach(() => {
    testStart = new Date();
  });
  const flushEmails = async () => {
    await settle(); // the queueing happens just after the bid's answer
    await prisma.pendingOutbidEmail.updateMany({
      where: { userId: { startsWith: `nt_${stamp}_` }, createdAt: { gte: testStart } },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    // sweep() returns at once when the background sweep is mid-run (a busy machine), so keep asking until nothing of ours is still due.
    for (let i = 0; i < 40; i++) {
      await app.get(NotificationsService).sweep();
      const left = await prisma.pendingOutbidEmail.count({ where: { userId: { startsWith: `nt_${stamp}_` }, createdAt: { gte: testStart }, dueAt: { lte: new Date() } } });
      if (left === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  const pending = (userId: string, listingId: string) => prisma.pendingOutbidEmail.findFirst({ where: { userId, listingId } });

  const bid = (person: Person, listingId: string, amountCents: number, key: string = randomUUID()) =>
    request(url).post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${person.token}`).send({ amountCents, idempotencyKey: key });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new RealtimeAdapter(app));
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    const mine = { email: { startsWith: "nt-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingOutbidEmail.deleteMany({ where: { userId: { startsWith: `nt_${stamp}_` } } });
    await prisma.pendingEndEmail.deleteMany({ where: { userId: { startsWith: `nt_${stamp}_` } } });
    await prisma.order.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  it("tells the outbid bidder by toast and email, and nobody else", async () => {
    const [anna, ben, cara] = await makePeople(3);
    const listing = await makeListing();
    await bid(anna, listing.id, 1000).expect(201);
    const [annaSocket, benSocket, caraSocket, spectator] = await Promise.all([open(anna), open(ben), open(cara), open()]);
    const annaGot = collect(annaSocket, SOCKET_EVENTS.outbid);
    const others = [benSocket, caraSocket, spectator].flatMap((s) => [collect(s, SOCKET_EVENTS.outbid), collect(s, SOCKET_EVENTS.extendedNotice)]);
    sent.length = 0;

    await bid(ben, listing.id, 1200).expect(201);
    await settle();

    expect(annaGot).toHaveLength(1);
    expect(annaGot[0] as OutbidNotice).toMatchObject({
      listingId: listing.id,
      title: "Notice test listing",
      // ben typed €12 but takes the lead one step above anna's €10.
      currentBidCents: 1100,
      minimumNextBidCents: 1200,
      extended: false,
      extensionCount: 0,
    });
    expect(others.every((got) => got.length === 0)).toBe(true);

    // The email waits, so a bidding war can collapse into one.
    expect(sent).toHaveLength(0);
    expect(await pending(anna.id, listing.id)).not.toBeNull();
    await flushEmails();

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(anna.email);
    expect(sent[0].subject).toContain("outbid");
    expect(sent[0].text).toContain("€11.00");
    expect(sent[0].text).toContain("€12.00");
    expect(sent[0].text).toContain(`/listings/${listing.id}`);
  });

  it("sends nothing for the first bid, a refused bid, or a replay", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    const annaSocket = await open(anna);
    const got = collect(annaSocket, SOCKET_EVENTS.outbid);
    sent.length = 0;

    await bid(anna, listing.id, 1000).expect(201);
    const key = randomUUID();
    await bid(ben, listing.id, 1100, key).expect(201);
    await bid(ben, listing.id, 1100, key).expect(200); // replay
    await bid(ben, listing.id, 1100).expect(409); // 11.00 is not above ben's own maximum
    await settle();
    await flushEmails();

    expect(got).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("on a late bid, adds the new end time to the outbid notice and toasts every other bidder, with no extra email", async () => {
    const [anna, ben, cara] = await makePeople(3);
    const listing = await makeListing({ endsAt: new Date(Date.now() + DAY) });
    // Anna bid early, Cara leads, then Ben bids at the last moment.
    await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() + DAY) } });
    await bid(anna, listing.id, 1000).expect(201);
    await bid(cara, listing.id, 1100).expect(201);
    await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() + 90_000) } });

    const [annaSocket, benSocket, caraSocket, sellerSocket] = await Promise.all([open(anna), open(ben), open(cara), open(seller)]);
    const annaExtended = collect(annaSocket, SOCKET_EVENTS.extendedNotice);
    const caraOutbid = collect(caraSocket, SOCKET_EVENTS.outbid);
    const quiet = [
      collect(benSocket, SOCKET_EVENTS.extendedNotice),
      collect(benSocket, SOCKET_EVENTS.outbid),
      collect(caraSocket, SOCKET_EVENTS.extendedNotice),
      collect(annaSocket, SOCKET_EVENTS.outbid),
      collect(sellerSocket, SOCKET_EVENTS.extendedNotice),
      collect(sellerSocket, SOCKET_EVENTS.outbid),
    ];
    sent.length = 0;

    await bid(ben, listing.id, 1300).expect(201);
    await settle();

    expect(annaExtended).toHaveLength(1);
    expect(annaExtended[0] as ExtendedNotice).toMatchObject({ listingId: listing.id, extensionCount: 1, final: false });
    expect(new Date((annaExtended[0] as ExtendedNotice).endsAt).getTime()).toBeGreaterThan(Date.now() + 100_000);

    expect(caraOutbid).toHaveLength(1);
    expect(caraOutbid[0] as OutbidNotice).toMatchObject({ extended: true, extensionCount: 1 });
    expect(quiet.every((got) => got.length === 0)).toBe(true);

    expect(sent.map((m) => m.to)).toEqual([cara.email]);
    expect(sent[0].text).toContain("Ends:");
  });

  it("marks the extension that reaches the ceiling as final, and sends no more extension notices after it", async () => {
    const [anna, ben, cara, dana] = await makePeople(4);
    const listing = await makeListing({ endsAt: new Date(Date.now() + DAY) });
    await bid(anna, listing.id, 1000).expect(201);
    await bid(dana, listing.id, 1100).expect(201);
    // A 1-day auction already extended for almost a day: the ceiling (start + 1 day + 24 hours) is 30 seconds away.
    const ceiling = Date.now() + 30_000;
    await prisma.listing.update({
      where: { id: listing.id },
      data: { durationDays: 1, startsAt: new Date(ceiling - 2 * DAY), endsAt: new Date(Date.now() + 20_000), extensionCount: 40 },
    });
    const annaSocket = await open(anna);
    const got = collect(annaSocket, SOCKET_EVENTS.extendedNotice);

    await bid(ben, listing.id, 1300).expect(201);
    await settle();
    expect(got).toHaveLength(1);
    expect(got[0] as ExtendedNotice).toMatchObject({ extensionCount: 41, final: true });

    // The end is at the ceiling and cannot move, so a further late bid sends no extension notice.
    await bid(cara, listing.id, 1400).expect(201);
    await settle();
    expect(got).toHaveLength(1);
  });

  describe("proxy bidding", () => {
    it("drops the requester's waiting outbid email even when they are beaten at once", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 3000).expect(201); // ben leads at €11 and anna is outbid
      await settle();
      expect(await pending(anna.id, listing.id)).not.toBeNull();

      // Anna bids again with a maximum below ben's: ben defends, but anna is here, so she needs no email.
      const answer = await bid(anna, listing.id, 2000).expect(201);
      expect(answer.body.outcome).toBe("OUTBID_BY_PROXY");
      await settle();
      expect(await pending(anna.id, listing.id)).toBeNull();
    });

    it("on a late defended bid, toasts the other bidders but not the requester who was beaten at once, and calls nobody outbid", async () => {
      const [anna, ben, cara] = await makePeople(3);
      const listing = await makeListing({ endsAt: new Date(Date.now() + DAY) });
      await bid(cara, listing.id, 1000).expect(201);
      await bid(anna, listing.id, 5000).expect(201); // anna leads at €11 with a hidden €50
      await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() + 90_000) } });

      const [annaSocket, benSocket, caraSocket] = await Promise.all([open(anna), open(ben), open(cara)]);
      const caraExtended = collect(caraSocket, SOCKET_EVENTS.extendedNotice);
      const quiet = [
        collect(benSocket, SOCKET_EVENTS.extendedNotice),
        collect(benSocket, SOCKET_EVENTS.outbid),
        collect(annaSocket, SOCKET_EVENTS.extendedNotice),
        collect(annaSocket, SOCKET_EVENTS.outbid),
        collect(caraSocket, SOCKET_EVENTS.outbid),
      ];
      sent.length = 0;

      const answer = await bid(ben, listing.id, 2000).expect(201);
      expect(answer.body).toMatchObject({ outcome: "OUTBID_BY_PROXY", extended: true });
      await settle();
      await flushEmails();

      expect(caraExtended).toHaveLength(1);
      expect(quiet.every((got) => got.length === 0)).toBe(true);
      // The only email is cara's, for being outbid by anna during the setup; ben and anna get none.
      expect(sent.map((m) => m.to)).toEqual([cara.email]);
    });
  });

  describe("the outbid email wait", () => {
    it("is dropped when the person bids again before it is due", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 1100).expect(201);
      await settle();
      expect(await pending(anna.id, listing.id)).not.toBeNull();
      await bid(anna, listing.id, 1300).expect(201);
      await settle();
      expect(await pending(anna.id, listing.id)).toBeNull();
      sent.length = 0;
      await flushEmails();
      expect(sent.filter((m) => m.to === anna.email)).toHaveLength(0);
    });

    it("is dropped when the person is back in front", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 1100).expect(201);
      await prisma.listing.update({ where: { id: listing.id }, data: { highBidderId: anna.id } });
      sent.length = 0;
      await flushEmails();
      expect(sent.filter((m) => m.to === anna.email)).toHaveLength(0);
    });

    it("is dropped when the person has the auction page open, but not when they only have another page open", async () => {
      const [anna, ben, cara] = await makePeople(3);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000).expect(201);
      await bid(cara, listing.id, 1100).expect(201);
      const [annaSocket, benSocket] = await Promise.all([open(anna), open(ben)]);
      await annaSocket.emitWithAck(SOCKET_EVENTS.watch, listing.id);
      await bid(ben, listing.id, 1300).expect(201); // outbids cara
      await bid(cara, listing.id, 1500).expect(201); // outbids ben
      await benSocket.emitWithAck(SOCKET_EVENTS.watch, "some-other-listing");
      expect(await pending(anna.id, listing.id)).not.toBeNull(); // still waiting, and then skipped because she is watching
      sent.length = 0;
      await flushEmails();
      expect(sent.map((m) => m.to)).toEqual([ben.email]);
    });

    it("emails at once when the auction ends before the wait would be over, and once only for the rest of that war", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing({ endsAt: new Date(Date.now() + 90_000) });
      sent.length = 0;
      await bid(anna, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 1200).expect(201); // outbids anna, in the last 2 minutes
      await settle();
      expect(sent.map((m) => m.to)).toEqual([anna.email]); // no flush: it went out by itself

      await bid(anna, listing.id, 1400).expect(201);
      await bid(ben, listing.id, 1600).expect(201); // outbids anna again, but she was just emailed
      await flushEmails();
      expect(sent.filter((m) => m.to === anna.email)).toHaveLength(1); // ben, outbid by anna's bid, was emailed too
    });

    it("sends the second email once the quiet period is over", async () => {
      const quiet = process.env.OUTBID_EMAIL_QUIET_SECONDS;
      process.env.OUTBID_EMAIL_QUIET_SECONDS = "1";
      try {
        const [anna, ben] = await makePeople(2);
        const listing = await makeListing();
        await bid(anna, listing.id, 1000).expect(201);
        await bid(ben, listing.id, 1100).expect(201);
        sent.length = 0;
        await flushEmails();
        expect(sent).toHaveLength(1);
        await bid(anna, listing.id, 1300).expect(201);
        await bid(ben, listing.id, 1500).expect(201);
        await new Promise((resolve) => setTimeout(resolve, 2100));
        await flushEmails();
        expect(sent).toHaveLength(2);
      } finally {
        process.env.OUTBID_EMAIL_QUIET_SECONDS = quiet;
      }
    });

    it("sends no outbid email once the auction has ended: the ended email from the close covers it, once, with the final price", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 1200).expect(201);
      await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      sent.length = 0;
      await flushEmails();
      await app.get(AuctionCloseService).close(listing.id); // not sweep(): that returns at once if the background sweep is mid-run
      await app.get(MailOutbox).sweep();
      const about = sent.filter((m) => m.text.includes(`/listings/${listing.id}`));
      expect(about).toHaveLength(1); // not one from each
      expect(about[0].to).toBe(anna.email);
      expect(about[0].subject).toContain("has ended");
      expect(about[0].text).toContain("Final price: €11.00");
    });

    it("sends the winner a won toast when the auction closes in a sale, and nobody else, and nothing when there is no sale", async () => {
      const [anna, ben] = await makePeople(2);
      const sold = await makeListing();
      const noSale = await makeListing({ reservePriceCents: 90_000 });
      for (const l of [sold, noSale]) {
        await bid(anna, l.id, 1000).expect(201);
        await bid(ben, l.id, 1200).expect(201);
      }
      const [annaSocket, benSocket] = await Promise.all([open(anna), open(ben)]);
      const annaWon = collect(annaSocket, SOCKET_EVENTS.wonNotice);
      const benWon = collect(benSocket, SOCKET_EVENTS.wonNotice);
      await prisma.listing.updateMany({ where: { id: { in: [sold.id, noSale.id] } }, data: { endsAt: new Date(Date.now() - 1000) } });
      for (const l of [sold, noSale]) await app.get(AuctionCloseService).close(l.id);
      await settle();
      const order = await prisma.order.findFirstOrThrow({ where: { listingId: sold.id } });
      expect(benWon).toEqual([{ listingId: sold.id, title: "Notice test listing", finalPriceCents: 1100, orderId: order.id }]);
      expect(annaWon).toEqual([]);
    });

    it("saves the win for the bell, linking to the order to pay, for the winner only and only for a sale", async () => {
      const [anna, ben] = await makePeople(2);
      const sold = await makeListing();
      const noSale = await makeListing({ reservePriceCents: 90_000 });
      for (const l of [sold, noSale]) {
        await bid(anna, l.id, 1000).expect(201);
        await bid(ben, l.id, 1200).expect(201);
      }
      await prisma.listing.updateMany({ where: { id: { in: [sold.id, noSale.id] } }, data: { endsAt: new Date(Date.now() - 1000) } });
      for (const l of [sold, noSale]) await app.get(AuctionCloseService).close(l.id);
      await settle();
      const won = (person: Person) => request(url).get("/notifications").set("Authorization", `Bearer ${person.token}`).then((r) => (r.body.items as { type: string; listingId: string; data: unknown }[]).filter((n) => n.type === "WON"));
      const order = await prisma.order.findFirstOrThrow({ where: { listingId: sold.id } });
      expect(await won(ben)).toMatchObject([{ listingId: sold.id, data: { finalPriceCents: 1100, orderId: order.id } }]);
      expect(await won(anna)).toEqual([]);

    });

    it("sends the next bidder an offer toast, and nobody else, when the winner does not pay", async () => {
      const [anna, ben, cara] = await makePeople(3);
      const listing = await makeListing();
      await bid(cara, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 1200).expect(201);
      await bid(anna, listing.id, 1400).expect(201);
      await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      await app.get(AuctionCloseService).close(listing.id);
      await settle();
      const [annaSocket, benSocket, caraSocket] = await Promise.all([open(anna), open(ben), open(cara)]);
      const annaWon = collect(annaSocket, SOCKET_EVENTS.wonNotice);
      const benWon = collect(benSocket, SOCKET_EVENTS.wonNotice);
      const caraWon = collect(caraSocket, SOCKET_EVENTS.wonNotice);
      const order = await prisma.order.findFirstOrThrow({ where: { listingId: listing.id } });
      await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() - 1000) } });
      await app.get(OrderExpiryService).expire(order.id);
      await settle();
      const offer = await prisma.order.findFirstOrThrow({ where: { listingId: listing.id, buyerId: ben.id } });
      expect(benWon).toEqual([{ listingId: listing.id, title: "Notice test listing", finalPriceCents: 1200, offered: true, orderId: offer.id }]);
      // The first buyer's "pay now" notice is gone, and the next bidder has theirs, worded as an offer.
      const mine = async (person: Person) => (await request(url).get("/notifications").set("Authorization", `Bearer ${person.token}`)).body.items.filter((n: { type: string }) => n.type === "WON");
      expect(await mine(anna)).toEqual([]);
      expect(await mine(ben)).toMatchObject([{ data: { offered: true, orderId: offer.id } }]);
      expect(annaWon).toEqual([]);
      expect(caraWon).toEqual([]);
    });

    it("is kept in the database, so another API machine sends it after a restart", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 1100).expect(201);
      await settle();
      await prisma.pendingOutbidEmail.updateMany({ where: { userId: anna.id }, data: { dueAt: new Date(Date.now() - 1000) } });
      sent.length = 0;
      const second = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(SEARCH_INDEX)
        .useValue(new NoopSearchIndex())
        .overrideProvider(MAIL_SENDER)
        .useValue(mail)
        .compile();
      const other = second.createNestApplication();
      other.useWebSocketAdapter(new RealtimeAdapter(other));
      await other.listen(0);
      try {
        await other.get(NotificationsService).sweep();
        await app.get(NotificationsService).sweep();
        // Sent once, by whichever got there first. (Only mail about this listing: a second app also sends any other
        // auction-ended email that happens to be waiting in the shared database.)
        expect(sent.filter((m) => m.text.includes(listing.id)).map((m) => m.to)).toEqual([anna.email]);
      } finally {
        await other.close();
      }
    });
  });

  describe("a failed or interrupted outbid email", () => {
    const outbidPair = async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      await bid(anna, listing.id, 1000).expect(201);
      await bid(ben, listing.id, 1100).expect(201);
      await settle();
      return { anna, listing };
    };
    const makeDue = (userId: string) =>
      prisma.pendingOutbidEmail.updateMany({ where: { userId }, data: { dueAt: new Date(Date.now() - 1000) } });

    it("stays queued when the send fails, is tried again, and is not held back by the quiet period", async () => {
      const { anna, listing } = await outbidPair();
      sent.length = 0;
      mailFails = true;
      try {
        await makeDue(anna.id);
        await app.get(NotificationsService).sweep();
      } finally {
        mailFails = false;
      }
      expect(sent).toHaveLength(0);
      const row = await pending(anna.id, listing.id);
      expect(row).not.toBeNull();
      expect(row!.attempts).toBe(1);
      expect(row!.dueAt.getTime()).toBeGreaterThan(Date.now()); // leased, so it is not retried this instant

      await makeDue(anna.id);
      await app.get(NotificationsService).sweep();
      expect(sent.map((m) => m.to)).toEqual([anna.email]);
      expect(await pending(anna.id, listing.id)).toBeNull();
    });

    it("gives up after three tries instead of retrying for ever", async () => {
      const { anna, listing } = await outbidPair();
      mailFails = true;
      try {
        for (let i = 0; i < 3; i++) {
          await makeDue(anna.id);
          await app.get(NotificationsService).sweep();
          expect((await pending(anna.id, listing.id))?.attempts).toBe(i + 1);
        }
        await makeDue(anna.id);
        await app.get(NotificationsService).sweep();
      } finally {
        mailFails = false;
      }
      expect(await pending(anna.id, listing.id)).toBeNull();
    });

    it("is not sent twice, and not lost, when the machine stopped mid-send: the lease runs out and it is sent once", async () => {
      const { anna, listing } = await outbidPair();
      // As if a machine claimed the row (attempt 1) and stopped before sending.
      await prisma.pendingOutbidEmail.updateMany({ where: { userId: anna.id }, data: { attempts: 1, dueAt: new Date(Date.now() + 60_000) } });
      sent.length = 0;
      await app.get(NotificationsService).sweep();
      expect(sent).toHaveLength(0); // still leased
      await makeDue(anna.id);
      await app.get(NotificationsService).sweep();
      expect(sent.map((m) => m.to)).toEqual([anna.email]);
      expect(await pending(anna.id, listing.id)).toBeNull();
    });
  });

  it("never lets a failing email break the bid or the toast", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    await bid(anna, listing.id, 1000).expect(201);
    const annaSocket = await open(anna);
    const got = collect(annaSocket, SOCKET_EVENTS.outbid);
    mailFails = true;
    try {
      await bid(ben, listing.id, 1100).expect(201);
      await settle();
      await flushEmails();
    } finally {
      mailFails = false;
    }
    expect(got).toHaveLength(1);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).highBidderId).toBe(ben.id);
  });
});

import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SOCKET_EVENTS, type ExtendedNotice, type OutbidNotice } from "@auction/shared";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { RealtimeAdapter } from "../src/realtime/realtime.adapter";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const MINUTE = 60_000;

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
      currentBidCents: 1200,
      minimumNextBidCents: 1300,
      extended: false,
      extensionCount: 0,
    });
    expect(others.every((got) => got.length === 0)).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(anna.email);
    expect(sent[0].subject).toContain("outbid");
    expect(sent[0].text).toContain("€12.00");
    expect(sent[0].text).toContain("€13.00");
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
    await bid(ben, listing.id, 1200).expect(409); // ben already leads
    await settle();

    expect(got).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("on a late bid, adds the new end time to the outbid notice and toasts every other bidder, with no extra email", async () => {
    const [anna, ben, cara] = await makePeople(3);
    const listing = await makeListing({ endsAt: new Date(Date.now() + 2 * MINUTE) });
    // Anna bid early, Cara leads, then Ben bids at the last moment.
    await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() + DAY) } });
    await bid(anna, listing.id, 1000).expect(201);
    await bid(cara, listing.id, 1100).expect(201);
    await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() + 2 * MINUTE) } });

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
    expect(new Date((annaExtended[0] as ExtendedNotice).endsAt).getTime()).toBeGreaterThan(Date.now() + 14 * MINUTE);

    expect(caraOutbid).toHaveLength(1);
    expect(caraOutbid[0] as OutbidNotice).toMatchObject({ extended: true, extensionCount: 1 });
    expect(quiet.every((got) => got.length === 0)).toBe(true);

    expect(sent.map((m) => m.to)).toEqual([cara.email]);
    expect(sent[0].text).toContain("extended");
  });

  it("marks the second and last extension as final", async () => {
    const [anna, ben, cara, dana] = await makePeople(4);
    const listing = await makeListing({ endsAt: new Date(Date.now() + DAY) });
    await bid(anna, listing.id, 1000).expect(201);
    await bid(dana, listing.id, 1100).expect(201);
    await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() + 30_000), extensionCount: 1 } });
    const annaSocket = await open(anna);
    const got = collect(annaSocket, SOCKET_EVENTS.extendedNotice);

    await bid(ben, listing.id, 1300).expect(201);
    await settle();
    expect(got).toHaveLength(1);
    expect(got[0] as ExtendedNotice).toMatchObject({ extensionCount: 2, final: true });

    // The auction can no longer be extended, so a further late bid sends no extension notice.
    await bid(cara, listing.id, 1400).expect(201);
    await settle();
    expect(got).toHaveLength(1);
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
    } finally {
      mailFails = false;
    }
    expect(got).toHaveLength(1);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).highBidderId).toBe(ben.id);
  });
});

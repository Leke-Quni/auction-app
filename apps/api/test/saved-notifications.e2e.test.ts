import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SOCKET_EVENTS, type NotificationList, type UnreadEvent } from "@auction/shared";
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
import { SavedNotificationsService } from "../src/notifications/saved-notifications.service";
import { RealtimeAdapter } from "../src/realtime/realtime.adapter";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;

interface Person {
  id: string;
  token: string;
}

describe("saved notifications", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let categoryId: string;
  let seller: Person;
  let counter = 0;
  const sockets: Socket[] = [];

  const mail: MailSender = { async send() {} };

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return {
        id: `sn_${stamp}_${n}`,
        email: `sn-${n}-${stamp}@example.com`,
        firstName: "Saved",
        lastName: "Note",
        username: `sn${n}x${stamp}`,
        passwordHash: "!test",
        emailVerified: new Date(),
      };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        token: await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret()),
      })),
    );
  };

  const makeListing = (over: Record<string, unknown> = {}) =>
    prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Saved notice listing",
        description: "A listing for the saved notification tests.",
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

  const bid = (person: Person, listingId: string, amountCents: number) =>
    request(url).post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${person.token}`).send({ amountCents, idempotencyKey: randomUUID() });
  const list = (person: Person) => request(url).get("/notifications").set("Authorization", `Bearer ${person.token}`);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

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
    const mine = { email: { startsWith: "sn-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingOutbidEmail.deleteMany({ where: { userId: { startsWith: `sn_${stamp}_` } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  it("requires sign-in", async () => {
    await request(url).get("/notifications").expect(401);
    await request(url).post("/notifications/x/read").expect(401);
    await request(url).delete("/notifications/x").expect(401);
    await request(url).delete("/notifications").expect(401);
  });

  it("saves the outbid notice for the outbid bidder only, and tells their pages the unread count", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    await bid(anna, listing.id, 1000).expect(201);
    expect((await list(anna).expect(200)).body).toEqual({ items: [], unreadCount: 0 });

    const socket = connect(url, { auth: { token: anna.token }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    await settle();
    const unread: UnreadEvent[] = [];
    socket.on(SOCKET_EVENTS.unread, (event: UnreadEvent) => unread.push(event));

    await bid(ben, listing.id, 1200).expect(201);
    await settle();

    const mine = (await list(anna).expect(200)).body as NotificationList;
    expect(mine.unreadCount).toBe(1);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ type: "OUTBID", listingId: listing.id, title: "Saved notice listing", readAt: null });
    expect(mine.items[0].data).toMatchObject({ currentBidCents: 1200, minimumNextBidCents: 1300 });
    expect(unread).toEqual([{ unreadCount: 1 }]);
    expect((await list(ben).expect(200)).body).toEqual({ items: [], unreadCount: 0 });
  });

  it("keeps one notification per auction through a bidding war, as unread and newest", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    await bid(anna, listing.id, 1000).expect(201);
    await bid(ben, listing.id, 1100).expect(201);
    await settle();
    const first = ((await list(anna)).body as NotificationList).items[0];
    await request(url).post(`/notifications/${first.id}/read`).set("Authorization", `Bearer ${anna.token}`).expect(201);
    await bid(anna, listing.id, 1300).expect(201);
    await bid(ben, listing.id, 1500).expect(201);
    await settle();

    const after = (await list(anna)).body as NotificationList;
    expect(after.items).toHaveLength(1);
    expect(after.unreadCount).toBe(1);
    expect(after.items[0]).toMatchObject({ readAt: null, data: { currentBidCents: 1500 } });
  });

  it("marks one as read for its owner only", async () => {
    const [anna, ben, cara] = await makePeople(3);
    const listing = await makeListing();
    await bid(anna, listing.id, 1000).expect(201);
    await bid(ben, listing.id, 1100).expect(201);
    await settle();
    const [note] = ((await list(anna)).body as NotificationList).items;

    const stranger = await request(url).post(`/notifications/${note.id}/read`).set("Authorization", `Bearer ${cara.token}`).expect(201);
    expect(stranger.body).toEqual({ unreadCount: 0 });
    expect(((await list(anna)).body as NotificationList).unreadCount).toBe(1);

    const read = await request(url).post(`/notifications/${note.id}/read`).set("Authorization", `Bearer ${anna.token}`).expect(201);
    expect(read.body).toEqual({ unreadCount: 0 });
    const after = (await list(anna)).body as NotificationList;
    expect(after.items[0].readAt).not.toBeNull();
    await request(url).post(`/notifications/${note.id}/read`).set("Authorization", `Bearer ${anna.token}`).expect(201); // again: no change
  });

  it("lets a person dismiss one notification, or clear the whole inbox, and nobody else's", async () => {
    const [anna, ben, cara, dan] = await makePeople(4);
    const first = await makeListing();
    const second = await makeListing();
    for (const l of [first, second]) {
      await bid(anna, l.id, 1000).expect(201);
      await bid(ben, l.id, 1100).expect(201);
    }
    await settle();
    const [newer, older] = ((await list(anna)).body as NotificationList).items;
    expect(((await list(anna)).body as NotificationList).unreadCount).toBe(2);

    const stranger = await request(url).delete(`/notifications/${newer.id}`).set("Authorization", `Bearer ${cara.token}`).expect(200);
    expect(stranger.body).toEqual({ unreadCount: 0 });
    expect(((await list(anna)).body as NotificationList).items).toHaveLength(2);

    const dismissed = await request(url).delete(`/notifications/${newer.id}`).set("Authorization", `Bearer ${anna.token}`).expect(200);
    expect(dismissed.body).toEqual({ unreadCount: 1 });
    expect(((await list(anna)).body as NotificationList).items.map((i) => i.id)).toEqual([older.id]);
    await request(url).delete(`/notifications/${newer.id}`).set("Authorization", `Bearer ${anna.token}`).expect(200); // again: no change

    // Clearing empties only the caller's inbox.
    await bid(cara, first.id, 1300).expect(201);
    await bid(dan, first.id, 1400).expect(201);
    await settle();
    expect(((await list(cara)).body as NotificationList).items).toHaveLength(1);
    const cleared = await request(url).delete("/notifications").set("Authorization", `Bearer ${anna.token}`).expect(200);
    expect(cleared.body).toEqual({ unreadCount: 0 });
    expect(await list(anna).then((r) => r.body)).toEqual({ items: [], unreadCount: 0 });
    expect(((await list(cara)).body as NotificationList).items).toHaveLength(1);
  });

  it("saves the extension notice for the other bidders, not the new high bidder, the outbid bidder or the seller", async () => {
    const [anna, ben, cara, dan] = await makePeople(4);
    const listing = await makeListing({ startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() + 60_000) });
    await bid(anna, listing.id, 1000).expect(201);
    await bid(ben, listing.id, 1100).expect(201);
    await bid(cara, listing.id, 1300).expect(201);
    await settle();
    await prisma.notification.deleteMany({ where: { userId: { in: [anna.id, ben.id, cara.id] } } });

    await bid(dan, listing.id, 1500).expect(201);
    await settle();

    const annaNotes = (await list(anna)).body as NotificationList;
    expect(annaNotes.items.map((i) => i.type)).toEqual(["AUCTION_EXTENDED"]);
    expect(((await list(ben)).body as NotificationList).items.map((i) => i.type)).toEqual(["AUCTION_EXTENDED"]);
    // Cara was the one outbid, so she gets the outbid notice (which already says the end moved), not a second one.
    expect(((await list(cara)).body as NotificationList).items.map((i) => i.type)).toEqual(["OUTBID"]);
    expect((await list(dan)).body).toEqual({ items: [], unreadCount: 0 });
    expect((await list(seller)).body).toEqual({ items: [], unreadCount: 0 });
  });

  it("hides expired notifications and removes them", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    await bid(anna, listing.id, 1000).expect(201);
    await bid(ben, listing.id, 1100).expect(201);
    await settle();
    await prisma.notification.updateMany({ where: { userId: anna.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await list(anna)).body).toEqual({ items: [], unreadCount: 0 });
    await app.get(SavedNotificationsService).purgeExpired();
    expect(await prisma.notification.count({ where: { userId: anna.id } })).toBe(0);
  });

  it("expires 14 days after it was saved", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    await bid(anna, listing.id, 1000).expect(201);
    await bid(ben, listing.id, 1100).expect(201);
    await settle();
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: anna.id } });
    expect(Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / DAY)).toBe(14);
  });
});

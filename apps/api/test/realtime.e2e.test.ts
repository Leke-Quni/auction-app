import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { auctionRoom, SOCKET_EVENTS, userRoom, type AuctionExtendedEvent, type BidPlacedEvent } from "@auction/shared";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret, redisUrl } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { RealtimeAdapter } from "../src/realtime/realtime.adapter";
import { RealtimeGateway } from "../src/realtime/realtime.gateway";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;

interface Person {
  id: string;
  token: string;
}

describe("realtime", () => {
  const apps: INestApplication[] = [];
  const sockets: Socket[] = [];
  let prisma: Prisma;
  let categoryId: string;
  let seller: Person;
  let counter = 0;

  const startApp = async (withRedis = false) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .compile();
    const app = moduleRef.createNestApplication();
    const adapter = new RealtimeAdapter(app);
    if (withRedis) await adapter.connectRedis(redisUrl()!);
    app.useWebSocketAdapter(adapter);
    await app.listen(0);
    apps.push(app);
    return { app, url: `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}` };
  };

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return {
        id: `rt_${stamp}_${n}`,
        email: `rt-${n}-${stamp}@example.com`,
        firstName: "Real",
        lastName: "Time",
        username: `rt${n}x${stamp}`,
        passwordHash: "!test",
        emailVerified: new Date(),
      };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(rows.map(async (row) => ({ id: row.id, token: await tokenFor(row.id, row.email) })));
  };

  const tokenFor = (id: string, email: string) =>
    new SignJWT({ email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(id).setExpirationTime("10m").sign(authSecret());

  const makeListing = (over: Record<string, unknown> = {}) =>
    prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Realtime test listing",
        description: "A listing for the realtime tests.",
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

  const open = async (url: string, token?: string) => {
    const socket = connect(url, { auth: token ? { token } : {}, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  };

  const watch = (socket: Socket, listingId: string) => socket.emitWithAck(SOCKET_EVENTS.watch, listingId);
  const next = <T>(socket: Socket, event: string, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  const silent = async (socket: Socket, event: string) => {
    let heard = false;
    socket.once(event, () => (heard = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return !heard;
  };

  const bid = (url: string, person: Person, listingId: string, amountCents: number) =>
    request(url).post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${person.token}`).send({ amountCents, idempotencyKey: randomUUID() });

  beforeAll(async () => {
    const { app } = await startApp();
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    const mine = { email: { startsWith: "rt-", endsWith: `-${stamp}@example.com` } };
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    for (const app of apps) await app.close();
  });

  it("sends a placed bid to everyone watching that auction, and to nobody else", async () => {
    const { url } = { url: `http://localhost:${(apps[0].getHttpServer().address() as AddressInfo).port}` };
    const [bidder] = await makePeople(1);
    const listing = await makeListing();
    const other = await makeListing();
    const [a, b, elsewhere] = await Promise.all([open(url), open(url), open(url)]);
    await Promise.all([watch(a, listing.id), watch(b, listing.id), watch(elsewhere, other.id)]);

    const heardA = next<BidPlacedEvent>(a, SOCKET_EVENTS.bidPlaced);
    const heardB = next<BidPlacedEvent>(b, SOCKET_EVENTS.bidPlaced);
    const quiet = silent(elsewhere, SOCKET_EVENTS.bidPlaced);
    await bid(url, bidder, listing.id, 1500).expect(201);

    const [eventA, eventB] = await Promise.all([heardA, heardB]);
    expect(eventA).toEqual(eventB);
    expect(eventA).toMatchObject({
      listingId: listing.id,
      // The bidder typed a maximum of €15, but a first bid sets the starting price, and only the price is public.
      currentBidCents: 1000,
      bidCount: 1,
      extensionCount: 0,
      extended: false,
      highBidder: { id: bidder.id },
      bid: { amountCents: 1000, bidder: { id: bidder.id } },
    });
    // Every amount in the event is a price; the bidder's typed maximum of €15 is in none of them.
    const amounts = (value: unknown): number[] =>
      Array.isArray(value) ? value.flatMap(amounts) : value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => (k.endsWith("Cents") && typeof v === "number" ? [v] : amounts(v))) : [];
    expect(amounts(eventA)).not.toContain(1500);
    expect(eventA.minimumNextBidCents).toBe(1100);
    expect(await quiet).toBe(true);
  });

  it("announces an extension, and nothing for a refused bid", async () => {
    const url = `http://localhost:${(apps[0].getHttpServer().address() as AddressInfo).port}`;
    const [bidder, rival] = await makePeople(2);
    const listing = await makeListing({ endsAt: new Date(Date.now() + 90_000) });
    const viewer = await open(url);
    await watch(viewer, listing.id);

    const extended = next<AuctionExtendedEvent>(viewer, SOCKET_EVENTS.auctionExtended);
    const placed = next<BidPlacedEvent>(viewer, SOCKET_EVENTS.bidPlaced);
    await bid(url, bidder, listing.id, 1000).expect(201);
    const event = await extended;
    expect(await placed).toMatchObject({ extended: true, extensionCount: 1, endsAt: event.endsAt });
    expect(event).toMatchObject({ listingId: listing.id, extensionCount: 1 });
    expect(new Date(event.endsAt).getTime()).toBeGreaterThan(Date.now() + 100_000);

    const quiet = silent(viewer, SOCKET_EVENTS.bidPlaced);
    await bid(url, rival, listing.id, 1).expect(422);
    expect(await quiet).toBe(true);
  });

  it("keeps private rooms private", async () => {
    const url = `http://localhost:${(apps[0].getHttpServer().address() as AddressInfo).port}`;
    const [person] = await makePeople(1);
    const spectator = await open(url);
    const signedIn = await open(url, person.token);

    // Asking for someone's room by name gets nothing: watch only ever joins auction rooms.
    await spectator.emitWithAck(SOCKET_EVENTS.watch, userRoom(person.id));
    await spectator.emitWithAck(SOCKET_EVENTS.watch, `${person.id}`);
    const server = apps[0].get(RealtimeGateway) as unknown as { server: { to(room: string): { emit(event: string, ...args: unknown[]): void } } };
    const heard = next(signedIn, "private-test");
    const quiet = silent(spectator, "private-test");
    server.server.to(userRoom(person.id)).emit("private-test", "hello");
    await heard;
    expect(await quiet).toBe(true);
    expect(await watch(spectator, "../../x y")).toEqual({ ok: false });
  });

  it("refuses a connection with a bad token", async () => {
    const url = `http://localhost:${(apps[0].getHttpServer().address() as AddressInfo).port}`;
    const bad = connect(url, { auth: { token: "not-a-token" }, transports: ["websocket"], reconnection: false });
    sockets.push(bad);
    await new Promise<void>((resolve) => bad.once("disconnect", () => resolve()));
    expect(bad.connected).toBe(false);
  });

  it.runIf(Boolean(redisUrl()))("reaches viewers connected to another API machine through Redis", async () => {
    const one = await startApp(true);
    const two = await startApp(true);
    const [bidder] = await makePeople(1);
    const listing = await makeListing();
    const viewer = await open(one.url);
    await watch(viewer, listing.id);
    const heard = next<BidPlacedEvent>(viewer, SOCKET_EVENTS.bidPlaced);
    await bid(two.url, bidder, listing.id, 1000).expect(201);
    expect((await heard).listingId).toBe(listing.id);
  });

  it("sends concurrent bids in the order they were saved, with the bidder's name", async () => {
    const url = `http://localhost:${(apps[0].getHttpServer().address() as AddressInfo).port}`;
    const people = await makePeople(6);
    const listing = await makeListing();
    const viewer = await open(url);
    await watch(viewer, listing.id);
    const seen: BidPlacedEvent[] = [];
    viewer.on(SOCKET_EVENTS.bidPlaced, (event: BidPlacedEvent) => seen.push(event));

    await Promise.all(people.map((person, i) => bid(url, person, listing.id, 1000 + i * 2000)));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(seen.length).toBeGreaterThan(0);
    const counts = seen.map((event) => event.bidCount);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(counts.length);
    for (const event of seen) {
      const row = await prisma.user.findUniqueOrThrow({ where: { id: event.highBidder.id } });
      expect(event.highBidder.username).toBe(row.username);
      expect(event.bid.bidder.username).toBe(row.username);
    }
  });

  it("lets one connection watch only so many auctions, and always lets it re-watch one it has", async () => {
    const url = `http://localhost:${(apps[0].getHttpServer().address() as AddressInfo).port}`;
    const socket = await open(url);
    for (let i = 0; i < 20; i++) expect(await watch(socket, `cap-${i}`)).toEqual({ ok: true });
    expect(await watch(socket, "cap-20")).toEqual({ ok: false });
    expect(await watch(socket, "cap-3")).toEqual({ ok: true });
    await socket.emitWithAck(SOCKET_EVENTS.unwatch, "cap-0");
    expect(await watch(socket, "cap-20")).toEqual({ ok: true });
  });

  it("is told nothing about auctions it stopped watching", async () => {
    const url = `http://localhost:${(apps[0].getHttpServer().address() as AddressInfo).port}`;
    const [bidder] = await makePeople(1);
    const listing = await makeListing();
    const viewer = await open(url);
    await watch(viewer, listing.id);
    await viewer.emitWithAck(SOCKET_EVENTS.unwatch, listing.id);
    const quiet = silent(viewer, SOCKET_EVENTS.bidPlaced);
    await bid(url, bidder, listing.id, 1000).expect(201);
    expect(await quiet).toBe(true);
    expect(auctionRoom(listing.id)).toBe(`auction:${listing.id}`);
  });
});

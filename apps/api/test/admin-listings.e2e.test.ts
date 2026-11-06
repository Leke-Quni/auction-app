import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { AuctionEvents, type AuctionEvent } from "../src/bids/auction-events";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { NoopSearchIndex, SEARCH_INDEX, type SearchIndex } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;

describe("an admin removing a listing", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let categoryId: string;
  let counter = 0;
  const removedFromSearch: string[] = [];
  const sent: { to: string; text: string }[] = [];
  const closed: Extract<AuctionEvent, { type: "AuctionClosed" }>[] = [];
  const userIds: string[] = [];
  const listingIds: string[] = [];

  type Who = { id: string; email: string; username: string; auth: Record<string, string> };
  const person = async (role: "USER" | "ADMIN" = "USER"): Promise<Who> => {
    const n = ++counter;
    const row = { id: `al_${stamp}_${n}`, email: `al-${n}-${stamp}@example.com`, firstName: "Admin", lastName: "Listings", username: `al${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date(), role };
    await prisma.user.create({ data: row });
    userIds.push(row.id);
    const token = await new SignJWT({ email: row.email, role }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret());
    return { id: row.id, email: row.email, username: row.username, auth: { Authorization: `Bearer ${token}` } };
  };

  beforeAll(async () => {
    const search: SearchIndex = Object.assign(new NoopSearchIndex(), { remove: async (id: string) => void removedFromSearch.push(id) });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(search)
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, _subject: string, text: string) => void sent.push({ to, text }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
    app.get(AuctionEvents).stream.subscribe((e) => {
      if (e.type === "AuctionClosed" && listingIds.includes(e.listingId)) closed.push(e);
    });
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.adminAction.deleteMany({ where: { adminId: { in: userIds } } });
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.order.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bid.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bidAudit.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const listing = async (sellerId: string, over: Record<string, unknown> = {}) => {
    const l = await prisma.listing.create({
      data: {
        sellerId, title: `Removal test ${stamp}-${++counter}`, description: "For the admin removal tests.", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3,
        status: "PUBLISHED", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date(Date.now() - DAY), ...over,
      },
    });
    listingIds.push(l.id);
    return l;
  };
  // A live auction with two bidders, the second of whom leads and has met the reserve.
  const biddingWar = async (seller: Who, over: Record<string, unknown> = {}) => {
    const [a, b] = [await person(), await person()];
    const l = await listing(seller.id, { reservePriceCents: 2000, currentBidCents: 3000, bidCount: 2, highBidderId: b.id, ...over });
    await prisma.bid.createMany({
      data: [
        { listingId: l.id, bidderId: a.id, amountCents: 2000, idempotencyKey: randomUUID() },
        { listingId: l.id, bidderId: b.id, amountCents: 3000, idempotencyKey: randomUUID() },
      ],
    });
    return { l, a, b };
  };
  const remove = (who: Who, id: string, body: unknown = { reason: "Prohibited item" }) => request(url).post(`/admin/listings/${id}/remove`).set(who.auth).send(body as object);

  it("is for admins only", async () => {
    const user = await person();
    const seller = await person();
    const l = await listing(seller.id);
    await request(url).post(`/admin/listings/${l.id}/remove`).send({ reason: "x" }).expect(401);
    await remove(user, l.id).expect(403);
    await request(url).get(`/admin/listings/${l.id}`).set(user.auth).expect(403);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).closedAt).toBeNull();
  });

  it("ends a live auction that has bids and met its reserve with no sale, and tells every bidder", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const { l, a, b } = await biddingWar(seller);
    const res = await remove(admin, l.id, { reason: "  Counterfeit goods  " }).expect(200);

    expect(res.body).toMatchObject({ id: l.id, phase: "ended", outcome: "NO_SALE", bidCount: 2, removal: { reason: "Counterfeit goods", by: { id: admin.id, username: admin.username } } });
    const stored = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
    expect(stored).toMatchObject({ outcome: "NO_SALE", winnerId: null, finalPriceCents: null, removedById: admin.id, removalReason: "Counterfeit goods" });
    expect(stored.closedAt).toBeInstanceOf(Date);
    expect(await prisma.adminAction.findMany({ where: { targetId: l.id } })).toMatchObject([{ action: "REMOVE_LISTING", adminId: admin.id, reason: "Counterfeit goods" }]);
    expect(stored.endsAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await prisma.order.count({ where: { listingId: l.id } })).toBe(0);
    // The email sweep sends the rows as soon as the close is announced, so wait for the mail itself.
    const emails = async (address: string) => {
      for (let i = 0; i < 50 && !sent.some((m) => m.to === address && m.text.includes(l.title)); i++) await new Promise((r) => setTimeout(r, 100));
      return sent.filter((m) => m.to === address && m.text.includes(l.title));
    };
    for (const bidder of [a, b]) {
      const mail = await emails(bidder.email);
      expect(mail).toHaveLength(1);
      expect(mail[0].text).toContain("ended early by a moderator");
    }
    expect(closed).toContainEqual({ type: "AuctionClosed", listingId: l.id, outcome: "NO_SALE", winnerId: null, finalPriceCents: null });
    expect(removedFromSearch).toContain(l.id);
  });

  it("ends an auction with no bids as NO_BIDS and an upcoming one before it starts", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const live = await listing(seller.id);
    const upcoming = await listing(seller.id, { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 4 * DAY) });
    expect((await remove(admin, live.id).expect(200)).body).toMatchObject({ outcome: "NO_BIDS", phase: "ended" });
    expect((await remove(admin, upcoming.id).expect(200)).body).toMatchObject({ outcome: "NO_BIDS", phase: "ended" });
    const stored = await prisma.listing.findUniqueOrThrow({ where: { id: upcoming.id } });
    expect(stored.startsAt!.getTime()).toBeLessThanOrEqual(stored.endsAt!.getTime());
    expect(await prisma.pendingEndEmail.count({ where: { listingId: { in: [live.id, upcoming.id] } } })).toBe(0);
  });

  it("refuses a second removal, a draft, a sold auction, an unknown id and a missing reason", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const l = await listing(seller.id);
    await remove(admin, l.id).expect(200);
    expect((await remove(admin, l.id).expect(409)).body.code).toBe("ALREADY_CLOSED");
    const draft = await listing(seller.id, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    expect((await remove(admin, draft.id).expect(409)).body.code).toBe("NOT_PUBLISHED");
    const sold = await listing(seller.id, { startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - DAY), closedAt: new Date(), outcome: "NO_BIDS" });
    expect((await remove(admin, sold.id).expect(409)).body.code).toBe("ALREADY_CLOSED");
    await remove(admin, "nope").expect(404);
    const fresh = await listing(seller.id);
    await remove(admin, fresh.id, {}).expect(400);
    await remove(admin, fresh.id, { reason: "   " }).expect(400);
    await remove(admin, fresh.id, { reason: "x".repeat(501) }).expect(400);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: fresh.id } })).closedAt).toBeNull();
  });

  it("does not turn a won auction into 'no sale' when it has ended but is not closed yet: the removal is refused and the normal close sells it", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const { l, b } = await biddingWar(seller, { startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - 5000) });
    const refused = await remove(admin, l.id).expect(409);
    expect(refused.body.code).toBe("AUCTION_ENDED");
    expect(await prisma.listing.findUniqueOrThrow({ where: { id: l.id }, select: { removedAt: true, closedAt: true } })).toEqual({ removedAt: null, closedAt: null });
    await app.get(AuctionCloseService).close(l.id);
    expect(await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ outcome: "SOLD", winnerId: b.id, finalPriceCents: 3000, removedAt: null });
    expect(await prisma.order.count({ where: { listingId: l.id, buyerId: b.id } })).toBe(1);
  });

  it("keeps a removed listing as a record: the seller can neither delete it nor change its words or photos", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const l = await listing(seller.id);
    await remove(admin, l.id, { reason: "Offensive text" }).expect(200);
    const del = await request(url).delete(`/listings/${l.id}`).set(seller.auth).expect(409);
    expect(del.body.message).toMatch(/moderator removed/);
    expect(await prisma.listing.count({ where: { id: l.id } })).toBe(1);
    await request(url).patch(`/listings/${l.id}`).set(seller.auth).send({ description: "The same offensive text again" }).expect(409);
    await request(url).put(`/listings/${l.id}/images`).set(seller.auth).send({ images: [] }).expect(409);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).description).toBe("For the admin removal tests.");
    expect((await request(url).get(`/admin/listings/${l.id}`).set(admin.auth).expect(200)).body.removal.reason).toBe("Offensive text");
  });

  it("lets a bid that is already in finish first, then closes with that bid counted and still no sale", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const bidder = await person();
    const l = await listing(seller.id);
    const placed = request(url).post(`/listings/${l.id}/bids`).set(bidder.auth).send({ amountCents: 1500, idempotencyKey: randomUUID() });
    const [bid, removal] = await Promise.all([placed, remove(admin, l.id)]);
    expect(removal.status).toBe(200);
    const stored = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
    expect(stored.closedAt).not.toBeNull();
    expect(stored.winnerId).toBeNull();
    expect(stored.outcome).toBe(stored.bidCount > 0 ? "NO_SALE" : "NO_BIDS");
    expect([201, 200, 409]).toContain(bid.status);
  });

  it("refuses bids afterwards, and the seller cannot list it again", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const bidder = await person();
    const l = await listing(seller.id);
    await remove(admin, l.id).expect(200);
    const refused = await request(url).post(`/listings/${l.id}/bids`).set(bidder.auth).send({ amountCents: 1500, idempotencyKey: randomUUID() });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("NOT_LIVE");
    expect((await request(url).post(`/listings/${l.id}/relist`).set(seller.auth).expect(409)).body.message).toMatch(/moderator/);
    expect(await prisma.listing.count({ where: { relistedFromId: l.id } })).toBe(0);
  });

  it("shows the page that it was removed, and the reason to the seller only", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const l = await listing(seller.id);
    expect((await request(url).get(`/listings/${l.id}`).expect(200)).body).toMatchObject({ removed: false });
    await remove(admin, l.id, { reason: "Not allowed here" }).expect(200);
    const publicView = (await request(url).get(`/listings/${l.id}`).expect(200)).body;
    expect(publicView.removed).toBe(true);
    expect(publicView).not.toHaveProperty("removalReason");
    const sellerView = (await request(url).get(`/listings/${l.id}`).set(seller.auth).expect(200)).body;
    expect(sellerView).toMatchObject({ removed: true, removalReason: "Not allowed here" });
  });

  it("reads a listing's moderation summary", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const { l, b } = await biddingWar(seller);
    const res = (await request(url).get(`/admin/listings/${l.id}`).set(admin.auth).expect(200)).body;
    expect(res).toMatchObject({ id: l.id, title: l.title, status: "PUBLISHED", phase: "live", bidCount: 2, currentBidCents: 3000, reservePriceCents: 2000, seller: { id: seller.id, username: seller.username }, highBidder: { id: b.id }, removal: null });
    await request(url).get("/admin/listings/nope").set(admin.auth).expect(404);
  });

  it("lists published listings by state and search, and counts open reports on the overview, for admins only", async () => {
    const admin = await person("ADMIN");
    const user = await person();
    const seller = await person();
    const title = `Lister ${stamp}`;
    const l = await listing(seller.id, { title });
    await request(url).get("/admin/listings").set(user.auth).expect(403);
    await request(url).get("/admin/overview").set(user.auth).expect(403);
    const byTitle = (await request(url).get(`/admin/listings?q=${title.replace(" ", "%20")}&phase=live`).set(admin.auth).expect(200)).body.listings;
    expect(byTitle).toMatchObject([{ id: l.id, phase: "live", seller: { id: seller.id }, removed: false }]);
    expect((await request(url).get(`/admin/listings?q=${seller.username}&phase=ended`).set(admin.auth).expect(200)).body.listings).toEqual([]);
    expect((await request(url).get(`/admin/overview`).set(admin.auth).expect(200)).body).toEqual(expect.objectContaining({ openReports: expect.any(Number), liveListings: expect.any(Number), users: expect.any(Number) }));
  });
});

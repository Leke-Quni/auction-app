import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { RealtimeAdapter } from "../src/realtime/realtime.adapter";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

describe("admin accounts: ban, unban and strikes", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let categoryId: string;
  const userIds: string[] = [];
  const listingIds: string[] = [];
  const sockets: Socket[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];

  type Who = { id: string; email: string; username: string; auth: Record<string, string>; token: string };
  const person = async (role: "USER" | "ADMIN" = "USER"): Promise<Who> => {
    const n = ++counter;
    const row = { id: `au_${stamp}_${n}`, email: `au-${n}-${stamp}@example.com`, firstName: "Admin", lastName: "Users", username: `au${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date(), role };
    await prisma.user.create({ data: row });
    userIds.push(row.id);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret());
    return { id: row.id, email: row.email, username: row.username, token, auth: { Authorization: `Bearer ${token}` } };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new RealtimeAdapter(app));
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await prisma.adminAction.deleteMany({ where: { adminId: { in: userIds } } });
    await prisma.strike.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.bidAudit.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bid.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const ban = (admin: Who, id: string, body: unknown = { reason: "Fraud" }) => request(url).post(`/admin/users/${id}/ban`).set(admin.auth).send(body as object);
  const unban = (admin: Who, id: string) => request(url).post(`/admin/users/${id}/unban`).set(admin.auth);
  const strike = (userId: string) => prisma.strike.create({ data: { userId, listingId: `gone_${stamp}_${++counter}`, orderId: `order_${stamp}_${++counter}` } });

  it("is for admins only", async () => {
    const user = await person();
    const target = await person();
    await request(url).get("/admin/users").expect(401);
    await request(url).get("/admin/users").set(user.auth).expect(403);
    await request(url).get(`/admin/users/${target.id}`).set(user.auth).expect(403);
    await ban(user, target.id).expect(403);
    await unban(user, target.id).expect(403);
    await request(url).delete("/admin/strikes/x").set(user.auth).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).bannedAt).toBeNull();
  });

  it("finds accounts by name or email, and only the banned ones on request", async () => {
    const admin = await person("ADMIN");
    const a = await person();
    const b = await person();
    await ban(admin, b.id).expect(200);
    await strike(a.id);
    const byName = (await request(url).get(`/admin/users?q=${a.username.toUpperCase()}`).set(admin.auth).expect(200)).body.users;
    expect(byName).toHaveLength(1);
    expect(byName[0]).toMatchObject({ id: a.id, username: a.username, email: a.email, role: "USER", strikeCount: 1, bannedAt: null });
    expect((await request(url).get(`/admin/users?q=${encodeURIComponent(b.email)}`).set(admin.auth).expect(200)).body.users[0]).toMatchObject({ id: b.id, banReason: "Fraud" });
    const banned = (await request(url).get(`/admin/users?banned=true&q=au`).set(admin.auth).expect(200)).body.users;
    expect(banned.map((u: { id: string }) => u.id)).toContain(b.id);
    expect(banned.map((u: { id: string }) => u.id)).not.toContain(a.id);
    await request(url).get("/admin/users?limit=0").set(admin.auth).expect(400);
    await request(url).get("/admin/users/nope").set(admin.auth).expect(404);
  });

  it("bans: the very next request is refused, the reason is kept, and unbanning restores access", async () => {
    const admin = await person("ADMIN");
    const user = await person();
    await request(url).get("/notifications").set(user.auth).expect(200);
    const res = await ban(admin, user.id, { reason: "  Shill bidding  " }).expect(200);
    expect(res.body).toMatchObject({ id: user.id, banReason: "Shill bidding" });
    expect(res.body.bannedAt).toEqual(expect.any(String));
    const refused = await request(url).get("/notifications").set(user.auth).expect(403);
    expect(refused.body.code).toBe("BANNED");
    const back = await unban(admin, user.id).expect(200);
    expect(back.body).toMatchObject({ bannedAt: null, banReason: null });
    await request(url).get("/notifications").set(user.auth).expect(200);
  });

  it("refuses to ban an admin, someone already banned, an unknown id or a missing reason, and to unban someone who is not banned", async () => {
    const admin = await person("ADMIN");
    const other = await person("ADMIN");
    const user = await person();
    expect((await ban(admin, other.id).expect(409)).body.code).toBe("CANNOT_BAN_ADMIN");
    expect((await ban(admin, admin.id).expect(409)).body.code).toBe("CANNOT_BAN_ADMIN");
    await request(url).get("/admin/me").set(other.auth).expect(200);
    await ban(admin, "nope").expect(404);
    await ban(admin, user.id, {}).expect(400);
    await ban(admin, user.id, { reason: "   " }).expect(400);
    await ban(admin, user.id, { reason: "x".repeat(501) }).expect(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).bannedAt).toBeNull();
    expect((await unban(admin, user.id).expect(409)).body.code).toBe("NOT_BANNED");
    await ban(admin, user.id).expect(200);
    expect((await ban(admin, user.id, { reason: "Again" }).expect(409)).body.code).toBe("ALREADY_BANNED");
    expect(sent.filter((m) => m.to === user.email)).toMatchObject([{ subject: "Your account has been suspended", text: expect.stringContaining("Reason: Fraud") }]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).banReason).toBe("Fraud");
    await unban(admin, "nope").expect(404);
  });

  it("bans once when two admins ban the same person at the same moment", async () => {
    const [a1, a2] = [await person("ADMIN"), await person("ADMIN")];
    const user = await person();
    const results = await Promise.all([ban(a1, user.id, { reason: "One" }), ban(a2, user.id, { reason: "Two" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("hangs up a banned person's open connection at once and tells it why", async () => {
    const admin = await person("ADMIN");
    const user = await person();
    const bystander = await person();
    const open = async (p: Who) => {
      const socket = connect(url, { transports: ["websocket"], auth: { token: p.token } });
      sockets.push(socket);
      await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
      return socket;
    };
    const [mine, myOtherTab, theirs] = [await open(user), await open(user), await open(bystander)];
    const told = new Promise<{ code: string }>((resolve) => mine.on("connect_error_auth", resolve));
    const gone = new Promise<void>((resolve) => myOtherTab.on("disconnect", () => resolve()));
    await ban(admin, user.id).expect(200);
    expect((await told).code).toBe("BANNED");
    await gone;
    await new Promise((r) => setTimeout(r, 200));
    expect(mine.connected).toBe(false);
    expect(myOtherTab.connected).toBe(false);
    expect(theirs.connected).toBe(true);
  });

  it("clears a strike so a person at the limit can bid again, and lists the strikes with their listings", async () => {
    const admin = await person("ADMIN");
    const seller = await person();
    const bidder = await person();
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id, title: `Strike test ${stamp}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date(Date.now() - DAY),
      },
    });
    listingIds.push(listing.id);
    await prisma.strike.create({ data: { userId: bidder.id, listingId: listing.id, orderId: `order_${stamp}_a` } });
    await strike(bidder.id);
    const bid = () => request(url).post(`/listings/${listing.id}/bids`).set(bidder.auth).send({ amountCents: 1500, idempotencyKey: randomUUID() });
    expect((await bid().expect(403)).body.code).toBe("BLOCKED");
    const detail = (await request(url).get(`/admin/users/${bidder.id}`).set(admin.auth).expect(200)).body;
    expect(detail.strikeCount).toBe(2);
    expect(detail.strikes).toHaveLength(2);
    expect(detail.strikes.find((s: { listing: unknown }) => s.listing)).toMatchObject({ listing: { id: listing.id, title: listing.title } });
    const cleared = (await request(url).delete(`/admin/strikes/${detail.strikes[0].id}`).set(admin.auth).expect(200)).body;
    expect(cleared.strikeCount).toBe(1);
    await bid().expect(201);
    await request(url).delete(`/admin/strikes/${detail.strikes[0].id}`).set(admin.auth).expect(404);
  });

  it("records which admin banned, restored and cleared a strike, and only for changes that happened", async () => {
    const [a1, a2] = [await person("ADMIN"), await person("ADMIN")];
    const user = await person();
    await ban(a1, user.id, { reason: "Fraud" }).expect(200);
    await ban(a2, user.id, { reason: "Again" }).expect(409);
    await strike(user.id);
    const strikeId = (await request(url).get(`/admin/users/${user.id}`).set(a2.auth)).body.strikes[0].id;
    await request(url).delete(`/admin/strikes/${strikeId}`).set(a2.auth).expect(200);
    await request(url).delete(`/admin/strikes/${strikeId}`).set(a2.auth).expect(404);
    await unban(a2, user.id).expect(200);
    await unban(a2, user.id).expect(409);
    const log = (await request(url).get(`/admin/audit?targetId=${user.id}`).set(a1.auth).expect(200)).body.entries;
    expect(log.map((e: { action: string }) => e.action).sort()).toEqual(["BAN_USER", "CLEAR_STRIKE", "UNBAN_USER"]);
    expect(log.find((e: { action: string }) => e.action === "BAN_USER")).toMatchObject({ reason: "Fraud", admin: { id: a1.id, username: a1.username } });
    expect(log.find((e: { action: string }) => e.action === "UNBAN_USER").admin.id).toBe(a2.id);
    const mine = (await request(url).get(`/admin/audit?adminId=${a1.id}`).set(a1.auth).expect(200)).body.entries;
    expect(mine).toHaveLength(1);
    await request(url).get("/admin/audit").set(user.auth).expect(403);
  });
});

import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
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
let counter = 0;

describe("roles and bans are read from the database on every request", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  const sent: { to: string; text: string }[] = [];
  const mail: MailSender = { send: async (to, _subject, text) => void sent.push({ to, text }) };
  const sockets: Socket[] = [];
  const created: string[] = [];

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
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await prisma.loginCode.deleteMany({ where: { userId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  // A person in the database, and a token that claims whatever role the test wants (the token's claim must not matter).
  const person = async (over: Record<string, unknown> = {}) => {
    const n = ++counter;
    const row = { id: `rf_${stamp}_${n}`, email: `rf-${n}-${stamp}@example.com`, firstName: "Role", lastName: "Fresh", username: `rf${n}x${stamp}`, passwordHash: await bcrypt.hash("hunter22!", 4), emailVerified: new Date(), ...over };
    await prisma.user.create({ data: row as never });
    created.push(row.id);
    return row;
  };
  const tokenFor = (id: string, email: string, claimedRole: string) =>
    new SignJWT({ email, role: claimedRole }).setProtectedHeader({ alg: "HS256" }).setSubject(id).setExpirationTime("10m").sign(authSecret());
  const get = (path: string, token?: string) => request(url).get(path).set(token ? { Authorization: `Bearer ${token}` } : {});

  it("lets only an ADMIN in the database through the admin routes", async () => {
    const user = await person();
    const admin = await person({ role: "ADMIN" });
    await get("/admin/me").expect(401);
    expect((await get("/admin/me", await tokenFor(user.id, user.email, "USER")).expect(403)).body.code).toBe("NOT_ADMIN");
    const res = await get("/admin/me", await tokenFor(admin.id, admin.email, "ADMIN")).expect(200);
    expect(res.body).toEqual({ id: admin.id, email: admin.email, role: "ADMIN", isSuperAdmin: false });
  });

  it("accepts a token that carries only who is asking, since the email and role come from the database", async () => {
    const admin = await person({ role: "ADMIN" });
    const bare = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setExpirationTime("10m").sign(authSecret());
    expect((await get("/admin/me", bare).expect(200)).body).toEqual({ id: admin.id, email: admin.email, role: "ADMIN", isSuperAdmin: false });
    const unsigned = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(authSecret());
    await get("/admin/me", unsigned).expect(401);
  });

  it("ignores the role in the token: a token that says ADMIN is not enough, and one that says USER is not a limit", async () => {
    const user = await person();
    const admin = await person({ role: "ADMIN" });
    await get("/admin/me", await tokenFor(user.id, user.email, "ADMIN")).expect(403);
    expect((await get("/admin/me", await tokenFor(admin.id, admin.email, "USER")).expect(200)).body.role).toBe("ADMIN");
  });

  it("takes access away from a demoted admin on their very next request, and gives it to a promoted user at once", async () => {
    const admin = await person({ role: "ADMIN" });
    const token = await tokenFor(admin.id, admin.email, "ADMIN");
    await get("/admin/me", token).expect(200);
    await prisma.user.update({ where: { id: admin.id }, data: { role: "USER" } });
    await get("/admin/me", token).expect(403);
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await get("/admin/me", token).expect(200);
  });

  it("uses the email in the database, not the one in an old token", async () => {
    const admin = await person({ role: "ADMIN" });
    const token = await tokenFor(admin.id, admin.email, "ADMIN");
    const changed = `rf-new-${stamp}-${admin.id}@example.com`;
    await prisma.user.update({ where: { id: admin.id }, data: { email: changed } });
    expect((await get("/admin/me", token).expect(200)).body.email).toBe(changed);
  });

  it("refuses a banned account on every signed-in route at once, and lets it back in when unbanned", async () => {
    const user = await person();
    const token = await tokenFor(user.id, user.email, "USER");
    await get("/me", token).expect(200);
    await prisma.user.update({ where: { id: user.id }, data: { bannedAt: new Date(), banReason: "test" } });
    expect((await get("/me", token).expect(403)).body.code).toBe("BANNED");
    expect((await get("/orders", token).expect(403)).body.code).toBe("BANNED");
    await prisma.user.update({ where: { id: user.id }, data: { bannedAt: null, banReason: null } });
    await get("/me", token).expect(200);
  });

  it("treats a banned account as signed out on public pages instead of failing them", async () => {
    const seller = await person();
    const user = await person();
    const categoryId = (await prisma.category.findFirstOrThrow()).id;
    const listing = await prisma.listing.create({
      data: { sellerId: seller.id, title: "Ban test", description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 7, status: "PUBLISHED", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000), publishedAt: new Date() },
    });
    const token = await tokenFor(user.id, user.email, "USER");
    expect(await get(`/listings/${listing.id}`, token).expect(200).then((r) => r.body.watching)).toBe(false);
    await prisma.user.update({ where: { id: user.id }, data: { bannedAt: new Date() } });
    const page = (await get(`/listings/${listing.id}`, token).expect(200)).body;
    expect(page).not.toHaveProperty("watching");
    await prisma.listing.delete({ where: { id: listing.id } });
  });

  it("answers 401 for a token whose account no longer exists", async () => {
    const user = await person();
    const token = await tokenFor(user.id, user.email, "USER");
    await prisma.user.delete({ where: { id: user.id } });
    await get("/me", token).expect(401);
  });

  it("stops a banned account signing in: refused after the right password, no code sent, and a code cannot finish it", async () => {
    const user = await person({ bannedAt: new Date() });
    await request(url).post("/auth/login/start").send({ email: user.email, password: "wrong-password" }).expect(401);
    const before = sent.length;
    const res = await request(url).post("/auth/login/start").send({ email: user.email, password: "hunter22!" }).expect(403);
    expect(res.body.code).toBe("BANNED");
    expect(sent.length).toBe(before);
    // Even a valid code (put there by hand) does not finish a banned sign-in.
    await request(url).post("/auth/login/verify").send({ email: user.email, code: "123456" }).expect(401);
  });

  it("refuses a socket that connects with a banned account's token, and lets an ordinary one join", async () => {
    const banned = await person({ bannedAt: new Date() });
    const fine = await person();
    const open = async (p: { id: string; email: string }) => {
      const socket = connect(url, { transports: ["websocket"], auth: { token: await tokenFor(p.id, p.email, "USER") } });
      sockets.push(socket);
      return socket;
    };
    const refused = await open(banned);
    const why = await new Promise<{ code: string }>((resolve) => refused.on("connect_error_auth", resolve));
    expect(why.code).toBe("BANNED");
    await new Promise((r) => setTimeout(r, 300));
    expect(refused.connected).toBe(false);
    const ok = await open(fine);
    await new Promise<void>((resolve) => ok.on("connect", () => resolve()));
    await new Promise((r) => setTimeout(r, 300));
    expect(ok.connected).toBe(true);
  });
});

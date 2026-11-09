import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
let counter = 0;

describe("support requests and strike appeals", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const userIds: string[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];

  type Who = { id: string; username: string; auth: Record<string, string> };
  const person = async (role: "USER" | "ADMIN" = "USER"): Promise<Who> => {
    const n = ++counter;
    const row = { id: `sp_${stamp}_${n}`, email: `sp-${n}-${stamp}@example.com`, firstName: "Sup", lastName: "Port", username: `sp${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date(), role };
    await prisma.user.create({ data: row });
    userIds.push(row.id);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret());
    return { id: row.id, username: row.username, auth: { Authorization: `Bearer ${token}` } };
  };
  const strikeFor = (userId: string, over: Record<string, unknown> = {}) => prisma.strike.create({ data: { userId, orderId: `sp_order_${stamp}_${++counter}`, ...over } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
  });

  afterAll(async () => {
    await prisma.adminAction.deleteMany({ where: { adminId: { in: userIds } } });
    await prisma.supportRequest.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const send = (who: Who, body: unknown) => api().post("/support").set(who.auth).send(body as object);

  it("is for signed-in people only", async () => {
    await api().post("/support").send({ kind: "GENERAL", message: "hi" }).expect(401);
    await api().get("/support/strikes").expect(401);
  });

  it("saves a general question and rejects an empty or oversized one", async () => {
    const user = await person();
    const res = await send(user, { kind: "GENERAL", message: "  How do I change my username?  " }).expect(201);
    expect(await prisma.supportRequest.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ userId: user.id, kind: "GENERAL", strikeId: null, status: "OPEN", message: "How do I change my username?" });
    await send(user, { kind: "GENERAL", message: "   " }).expect(400);
    await send(user, { kind: "GENERAL", message: "x".repeat(2001) }).expect(400);
    await send(user, { kind: "OTHER", message: "hi" }).expect(400);
  });

  it("saves only one appeal when the same strike is appealed twice at once", async () => {
    const user = await person();
    const mine = await strikeFor(user.id);
    const codes = (await Promise.all([1, 2, 3].map(() => send(user, { kind: "STRIKE_APPEAL", strikeId: mine.id, message: "Please" })))).map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409]);
  });

  it("saves an appeal against the person's own strike, once while it is open, and never for someone else's strike", async () => {
    const [user, other] = [await person(), await person()];
    const mine = await strikeFor(user.id, { reason: "Abusive messages", givenById: "someone" });
    const theirs = await strikeFor(other.id);
    await send(user, { kind: "STRIKE_APPEAL", message: "It was a joke" }).expect(400);
    expect((await send(user, { kind: "STRIKE_APPEAL", strikeId: theirs.id, message: "Not mine" }).expect(404)).body.code).toBe("STRIKE_NOT_FOUND");
    await send(user, { kind: "STRIKE_APPEAL", strikeId: mine.id, message: "It was a joke" }).expect(201);
    expect((await send(user, { kind: "STRIKE_APPEAL", strikeId: mine.id, message: "Again" }).expect(409)).body.code).toBe("ALREADY_APPEALED");

    const listed = (await api().get("/support/strikes").set(user.auth).expect(200)).body;
    expect(listed).toMatchObject([{ id: mine.id, reason: "Abusive messages", givenByAdmin: true, appealed: true }]);
    expect((await api().get("/support/strikes").set(other.auth).expect(200)).body).toMatchObject([{ id: theirs.id, appealed: false }]);
  });

  it("allows five requests a day and then asks the person to wait", async () => {
    const user = await person();
    for (let i = 0; i < 5; i++) await send(user, { kind: "GENERAL", message: `Question ${i}` }).expect(201);
    expect((await send(user, { kind: "GENERAL", message: "One more" }).expect(429)).body.code).toBe("RATE_LIMITED");
  });

  it("shows admins the queue, oldest first, closes a request once, and counts the open ones on the overview", async () => {
    const admin = await person("ADMIN");
    const user = await person();
    const strike = await strikeFor(user.id, { reason: "Spam" });
    const appeal = (await send(user, { kind: "STRIKE_APPEAL", strikeId: strike.id, message: "Please clear it" }).expect(201)).body.id;
    const question = (await send(user, { kind: "GENERAL", message: "A question" }).expect(201)).body.id;

    await api().get("/admin/support").set(user.auth).expect(403);
    await api().post(`/admin/support/${appeal}/handle`).set(user.auth).expect(403);
    const open = (await api().get("/admin/support?limit=200").set(admin.auth).expect(200)).body;
    const mine = open.requests.filter((r: { id: string }) => [appeal, question].includes(r.id));
    expect(mine.map((r: { id: string }) => r.id)).toEqual([appeal, question]);
    expect(mine[0]).toMatchObject({ kind: "STRIKE_APPEAL", message: "Please clear it", user: { id: user.id, username: user.username, strikeCount: 1 }, strike: { id: strike.id, reason: "Spam" } });
    expect(mine[1]).toMatchObject({ kind: "GENERAL", strike: null });
    expect((await api().get("/admin/overview").set(admin.auth).expect(200)).body.openSupport).toBe(open.openCount);

    const done = (await api().post(`/admin/support/${question}/handle`).set(admin.auth).expect(200)).body;
    expect(done).toMatchObject({ id: question, status: "HANDLED", changed: true });
    const again = (await api().post(`/admin/support/${question}/handle`).set(admin.auth).expect(200)).body;
    expect(again).toMatchObject({ changed: false, handledAt: done.handledAt });
    await api().post("/admin/support/nope/handle").set(admin.auth).expect(404);
    expect(await prisma.adminAction.count({ where: { targetId: question, action: "HANDLE_SUPPORT" } })).toBe(1);
    const handled = (await api().get("/admin/support?status=HANDLED&limit=200").set(admin.auth).expect(200)).body.requests;
    expect(handled.map((r: { id: string }) => r.id)).toContain(question);
    expect((await api().get("/admin/support?limit=200").set(admin.auth).expect(200)).body.requests.map((r: { id: string }) => r.id)).not.toContain(question);
  });

  it("keeps an appeal after its strike is cleared, showing no strike, and a cleared strike can no longer be appealed", async () => {
    const admin = await person("ADMIN");
    const user = await person();
    const strike = await strikeFor(user.id);
    const id = (await send(user, { kind: "STRIKE_APPEAL", strikeId: strike.id, message: "Please" }).expect(201)).body.id;
    await api().delete(`/admin/strikes/${strike.id}`).set(admin.auth).expect(200);
    const row = (await api().get("/admin/support?limit=200").set(admin.auth).expect(200)).body.requests.find((r: { id: string }) => r.id === id);
    expect(row).toMatchObject({ kind: "STRIKE_APPEAL", strike: null });
    expect((await send(user, { kind: "STRIKE_APPEAL", strikeId: strike.id, message: "Again" }).expect(404)).body.code).toBe("STRIKE_NOT_FOUND");
  });

  it("grants an appeal in one step: the strike is cleared and the request closed, once, and a request someone else closed clears nothing", async () => {
    const admin = await person("ADMIN");
    const other = await person("ADMIN");
    const user = await person();
    const general = (await send(user, { kind: "GENERAL", message: "Hello" }).expect(201)).body.id;
    const strike = await strikeFor(user.id);
    const id = (await send(user, { kind: "STRIKE_APPEAL", strikeId: strike.id, message: "Please" }).expect(201)).body.id;
    await api().post(`/admin/support/${id}/grant`).set(user.auth).expect(403);
    await api().post("/admin/support/nope/grant").set(admin.auth).expect(404);
    expect((await api().post(`/admin/support/${general}/grant`).set(admin.auth).expect(409)).body.code).toBe("NOT_AN_APPEAL");

    expect((await api().post(`/admin/support/${id}/grant`).set(admin.auth).expect(200)).body).toMatchObject({ changed: true, strikeCleared: true });
    expect(await prisma.strike.count({ where: { id: strike.id } })).toBe(0);
    expect((await prisma.supportRequest.findUniqueOrThrow({ where: { id } })).status).toBe("HANDLED");
    expect(await prisma.adminAction.count({ where: { adminId: admin.id, action: { in: ["HANDLE_SUPPORT", "CLEAR_STRIKE"] } } })).toBe(2);
    expect((await api().post(`/admin/support/${id}/grant`).set(other.auth).expect(200)).body).toMatchObject({ changed: false, strikeCleared: false });

    // An appeal that was refused (closed) first must not clear the strike when another admin then clicks "grant".
    const second = await strikeFor(user.id);
    const refused = (await send(user, { kind: "STRIKE_APPEAL", strikeId: second.id, message: "Again" }).expect(201)).body.id;
    await api().post(`/admin/support/${refused}/handle`).set(admin.auth).expect(200);
    expect((await api().post(`/admin/support/${refused}/grant`).set(other.auth).expect(200)).body).toMatchObject({ changed: false });
    expect(await prisma.strike.count({ where: { id: second.id } })).toBe(1);
  });

  it("emails the person when an appeal is accepted or denied, and not for a general question or a repeat click", async () => {
    const admin = await person("ADMIN");
    const user = await person();
    const email = `sp-${counter}-${stamp}@example.com`;
    const mailsTo = () => sent.filter((m) => m.to === email);
    const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

    const granted = await strikeFor(user.id);
    const grantId = (await send(user, { kind: "STRIKE_APPEAL", strikeId: granted.id, message: "Please" }).expect(201)).body.id;
    await api().post(`/admin/support/${grantId}/grant`).set(admin.auth).expect(200);
    await api().post(`/admin/support/${grantId}/grant`).set(admin.auth).expect(200);
    await flush();
    expect(mailsTo().map((m) => m.subject)).toEqual(["Your strike appeal was accepted"]);

    const denied = await strikeFor(user.id);
    const denyId = (await send(user, { kind: "STRIKE_APPEAL", strikeId: denied.id, message: "Again" }).expect(201)).body.id;
    await api().post(`/admin/support/${denyId}/handle`).set(admin.auth).expect(200);
    await api().post(`/admin/support/${denyId}/handle`).set(admin.auth).expect(200);
    await flush();
    expect(mailsTo().map((m) => m.subject)).toEqual(["Your strike appeal was accepted", "Your strike appeal was denied"]);

    const general = (await send(user, { kind: "GENERAL", message: "Hello" }).expect(201)).body.id;
    await api().post(`/admin/support/${general}/handle`).set(admin.auth).expect(200);
    await flush();
    expect(mailsTo()).toHaveLength(2);
  });

  it("lets a suspended person write from the suspended page without signing in, and reveals nothing about accounts", async () => {
    const admin = await person("ADMIN");
    const banned = await person();
    const fine = await person();
    await prisma.user.update({ where: { id: banned.id }, data: { bannedAt: new Date(), banReason: "Fraud" } });
    const emailOf = async (who: Who) => (await prisma.user.findUniqueOrThrow({ where: { id: who.id }, select: { email: true } })).email;
    const post = (email: string, message = "Please lift my ban") => api().post("/support/suspended").send({ email, message });

    await post("not-an-email").expect(400);
    await api().post("/support/suspended").send({ email: await emailOf(banned), message: "  " }).expect(400);

    await post((await emailOf(banned)).toUpperCase()).expect(204);
    await post(await emailOf(banned), "Second try").expect(204);
    await post(await emailOf(fine)).expect(204);
    await post(`nobody-${stamp}@example.com`).expect(204);

    const open = (await api().get("/admin/support?limit=200").set(admin.auth).expect(200)).body.requests;
    const mine = open.filter((r: { user: { id: string } }) => r.user.id === banned.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "BAN_APPEAL", message: "Please lift my ban", user: { banned: true, banReason: "Fraud" } });
    expect(open.some((r: { user: { id: string } }) => r.user.id === fine.id)).toBe(false);

    const email = await emailOf(banned);
    await post(email).expect(204);
    await post(email).expect(429);
  });

  it("grants a ban appeal in one step: the ban is lifted and the request closed, once, and a request someone else closed lifts nothing", async () => {
    const admin = await person("ADMIN");
    const other = await person("ADMIN");
    const banned = await person();
    const user = await person();
    await prisma.user.updateMany({ where: { id: banned.id }, data: { bannedAt: new Date(), banReason: "Fraud" } });
    const emailOf = async (who: Who) => (await prisma.user.findUniqueOrThrow({ where: { id: who.id }, select: { email: true } })).email;
    await api().post("/support/suspended").send({ email: await emailOf(banned), message: "Sorry" }).expect(204);
    const id = (await prisma.supportRequest.findFirstOrThrow({ where: { userId: banned.id, kind: "BAN_APPEAL" } })).id;
    const general = (await send(user, { kind: "GENERAL", message: "Hello" }).expect(201)).body.id;

    await api().post(`/admin/support/${id}/lift-ban`).set(user.auth).expect(403);
    await api().post("/admin/support/nope/lift-ban").set(admin.auth).expect(404);
    expect((await api().post(`/admin/support/${general}/lift-ban`).set(admin.auth).expect(409)).body.code).toBe("NOT_A_BAN_APPEAL");

    expect((await api().post(`/admin/support/${id}/lift-ban`).set(admin.auth).expect(200)).body).toMatchObject({ changed: true, banLifted: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: banned.id } })).bannedAt).toBeNull();
    expect((await prisma.supportRequest.findUniqueOrThrow({ where: { id } })).status).toBe("HANDLED");
    expect(await prisma.adminAction.count({ where: { adminId: admin.id, action: { in: ["HANDLE_SUPPORT", "UNBAN_USER"] }, targetId: { in: [id, banned.id] } } })).toBe(2);
    expect((await api().post(`/admin/support/${id}/lift-ban`).set(other.auth).expect(200)).body).toMatchObject({ changed: false, banLifted: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const bannedEmail = await emailOf(banned);
    expect(sent.filter((m) => m.to === bannedEmail).map((m) => m.subject)).toEqual(["Your account has been restored"]);
  });

  it("emails a suspended person when their ban appeal is refused, but not when the ban was already lifted", async () => {
    const admin = await person("ADMIN");
    const refused = await person();
    const lifted = await person();
    for (const who of [refused, lifted]) await prisma.user.update({ where: { id: who.id }, data: { bannedAt: new Date(), banReason: "Fraud" } });
    const emailOf = async (who: Who) => (await prisma.user.findUniqueOrThrow({ where: { id: who.id }, select: { email: true } })).email;
    const appeal = async (who: Who) => {
      await api().post("/support/suspended").send({ email: await emailOf(who), message: "Please" }).expect(204);
      return (await prisma.supportRequest.findFirstOrThrow({ where: { userId: who.id, kind: "BAN_APPEAL" } })).id;
    };
    const refusedId = await appeal(refused);
    const liftedId = await appeal(lifted);
    await prisma.user.update({ where: { id: lifted.id }, data: { bannedAt: null, banReason: null } });

    await api().post(`/admin/support/${refusedId}/handle`).set(admin.auth).expect(200);
    await api().post(`/admin/support/${refusedId}/handle`).set(admin.auth).expect(200);
    await api().post(`/admin/support/${liftedId}/handle`).set(admin.auth).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const refusedEmail = await emailOf(refused);
    const liftedEmail = await emailOf(lifted);
    expect(sent.filter((m) => m.to === refusedEmail)).toMatchObject([{ subject: "Your suspension appeal was denied", text: expect.stringContaining("stays suspended") }]);
    expect(sent.filter((m) => m.to === liftedEmail)).toEqual([]);
  });
});

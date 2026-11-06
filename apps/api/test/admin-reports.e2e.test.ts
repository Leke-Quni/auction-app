import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();

describe("admin reports queue and question log", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let counter = 0;
  const userIds: string[] = [];
  const listingIds: string[] = [];
  const questionIds: string[] = [];

  const person = async (role: "USER" | "ADMIN" = "USER") => {
    const n = ++counter;
    const row = { id: `ar_${stamp}_${n}`, email: `ar-${n}-${stamp}@example.com`, firstName: "Admin", lastName: "Reports", username: `ar${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date(), role };
    await prisma.user.create({ data: row });
    userIds.push(row.id);
    const token = await new SignJWT({ email: row.email, role }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret());
    return { ...row, auth: { Authorization: `Bearer ${token}` } };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
  });

  afterAll(async () => {
    await prisma.adminAction.deleteMany({ where: { adminId: { in: userIds } } });
    await prisma.report.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.questionLog.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // A listing with one question and its answer, written by a real asker and seller.
  const scene = async () => {
    const seller = await person();
    const asker = await person();
    const category = await prisma.category.findFirstOrThrow();
    const listing = await prisma.listing.create({
      data: { sellerId: seller.id, title: `Reported listing ${stamp}-${counter}`, description: "For the admin reports tests.", categoryId: category.id, condition: "GOOD", startingPriceCents: 1000, durationDays: 1, status: "PUBLISHED", startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 86_400_000), publishedAt: new Date(Date.now() - 3600_000) },
    });
    listingIds.push(listing.id);
    const question = await prisma.question.create({ data: { listingId: listing.id, askerId: asker.id, body: "Call me on +38344123456", answer: "Sure, buy it now", answeredAt: new Date() } });
    questionIds.push(question.id);
    return { seller, asker, listing, question };
  };
  const get = (path: string, who?: { auth: Record<string, string> }) => request(url).get(path).set(who?.auth ?? {});

  it("keeps both routes for admins only", async () => {
    const user = await person();
    const admin = await person("ADMIN");
    await get("/admin/reports").expect(401);
    await get("/admin/reports", user).expect(403);
    await get("/admin/question-log", user).expect(403);
    await request(url).post("/admin/reports/anything/handle").set(user.auth).expect(403);
    await get("/admin/reports", admin).expect(200);
    await get("/admin/question-log", admin).expect(200);
  });

  it("lists open reports oldest first with who reported, who wrote it and the listing, then hides a handled one", async () => {
    const admin = await person("ADMIN");
    const { seller, asker, listing, question } = await scene();
    const reporter = await person();
    const first = await prisma.report.create({ data: { questionId: question.id, listingId: listing.id, target: "QUESTION", reporterId: reporter.id, reason: "SPAM", body: question.body, createdAt: new Date(Date.now() - 2000) } });
    const second = await prisma.report.create({ data: { questionId: question.id, listingId: listing.id, target: "ANSWER", reporterId: null, reason: "CONTACT_DETAILS", body: question.answer! } });

    const open = (await get("/admin/reports?limit=200", admin).expect(200)).body;
    const mine = open.reports.filter((r: { id: string }) => [first.id, second.id].includes(r.id));
    expect(mine.map((r: { id: string }) => r.id)).toEqual([first.id, second.id]);
    expect(mine[0]).toMatchObject({ status: "OPEN", reason: "SPAM", target: "QUESTION", body: question.body, reporter: { id: reporter.id, username: reporter.username }, author: { id: asker.id, username: asker.username }, listing: { id: listing.id, title: listing.title } });
    expect(mine[1]).toMatchObject({ reporter: null, reason: "CONTACT_DETAILS", target: "ANSWER", author: { id: seller.id, username: seller.username } });
    expect(open.openCount).toBeGreaterThanOrEqual(2);

    const done = await request(url).post(`/admin/reports/${first.id}/handle`).set(admin.auth).expect(200);
    expect(done.body).toMatchObject({ id: first.id, status: "HANDLED" });
    expect(done.body.handledAt).toEqual(expect.any(String));

    const after = (await get("/admin/reports?limit=200", admin).expect(200)).body;
    expect(after.reports.some((r: { id: string }) => r.id === first.id)).toBe(false);
    expect(after.reports.some((r: { id: string }) => r.id === second.id)).toBe(true);
    expect(after.openCount).toBe(open.openCount - 1);
    const handled = (await get("/admin/reports?status=HANDLED&limit=200", admin).expect(200)).body;
    expect(handled.reports.find((r: { id: string }) => r.id === first.id)).toMatchObject({ status: "HANDLED" });
  });

  it("handles a report once: a second click keeps the first time, and an unknown id is 404", async () => {
    const admin = await person("ADMIN");
    const { listing, question } = await scene();
    const report = await prisma.report.create({ data: { questionId: question.id, listingId: listing.id, target: "QUESTION", reason: "ABUSE", body: "rude" } });
    const a = (await request(url).post(`/admin/reports/${report.id}/handle`).set(admin.auth).expect(200)).body;
    const b = (await request(url).post(`/admin/reports/${report.id}/handle`).set(admin.auth).expect(200)).body;
    expect(b.handledAt).toBe(a.handledAt);
    await request(url).post("/admin/reports/nope/handle").set(admin.auth).expect(404);
  });

  it("still shows a report whose question and listing are gone, with the words as written", async () => {
    const admin = await person("ADMIN");
    const report = await prisma.report.create({ data: { questionId: `gone_${stamp}`, listingId: `gone_${stamp}`, target: "QUESTION", reporterId: `gone_${stamp}`, reason: "OTHER", body: "words as written" } });
    try {
      const found = (await get("/admin/reports?limit=200", admin).expect(200)).body.reports.find((r: { id: string }) => r.id === report.id);
      expect(found).toMatchObject({ body: "words as written", listing: null, author: null, reporter: { id: `gone_${stamp}`, username: null } });
    } finally {
      await prisma.report.delete({ where: { id: report.id } });
    }
  });

  it("rejects a bad status or limit", async () => {
    const admin = await person("ADMIN");
    await get("/admin/reports?status=ALL", admin).expect(400);
    await get("/admin/reports?limit=0", admin).expect(400);
    await get("/admin/question-log?limit=500", admin).expect(400);
  });

  it("reads the question log newest first, filtered by question, listing or person", async () => {
    const admin = await person("ADMIN");
    const { asker, seller, listing, question } = await scene();
    const other = await scene();
    const t = Date.now();
    await prisma.questionLog.createMany({
      data: [
        { questionId: question.id, listingId: listing.id, target: "QUESTION", action: "CREATED", actorId: asker.id, body: "first words", createdAt: new Date(t - 3000) },
        { questionId: question.id, listingId: listing.id, target: "QUESTION", action: "EDITED", actorId: asker.id, body: "second words", previousBody: "first words", createdAt: new Date(t - 2000) },
        { questionId: question.id, listingId: listing.id, target: "ANSWER", action: "DELETED", actorId: seller.id, body: "answer text", createdAt: new Date(t - 1000) },
        { questionId: other.question.id, listingId: other.listing.id, target: "QUESTION", action: "CREATED", actorId: other.asker.id, body: "elsewhere", createdAt: new Date(t) },
      ],
    });
    const byQuestion = (await get(`/admin/question-log?questionId=${question.id}`, admin).expect(200)).body.entries;
    expect(byQuestion.map((e: { action: string }) => e.action)).toEqual(["DELETED", "EDITED", "CREATED"]);
    expect(byQuestion[1]).toMatchObject({ body: "second words", previousBody: "first words", target: "QUESTION", actor: { id: asker.id, username: asker.username } });
    expect(byQuestion[0].actor).toEqual({ id: seller.id, username: seller.username });
    expect((await get(`/admin/question-log?listingId=${other.listing.id}`, admin).expect(200)).body.entries).toHaveLength(1);
    expect((await get(`/admin/question-log?actorId=${asker.id}`, admin).expect(200)).body.entries).toHaveLength(2);
    expect((await get(`/admin/question-log?questionId=${question.id}&limit=1`, admin).expect(200)).body.entries).toHaveLength(1);
  });

  it("removes a reported answer, leaving the question open, closes every report about it and writes the log and audit trail", async () => {
    const admin = await person("ADMIN");
    const { listing, question } = await scene();
    const [r1, r2] = [await person(), await person()];
    const mk = (reporterId: string) => prisma.report.create({ data: { questionId: question.id, listingId: listing.id, target: "ANSWER", reporterId, reason: "SPAM", body: question.answer!, postedAt: question.answeredAt! } });
    const [a, b] = [await mk(r1.id), await mk(r2.id)];
    await request(url).post(`/admin/reports/${a.id}/remove-post`).set(r1.auth).expect(403);

    expect((await request(url).post(`/admin/reports/${a.id}/remove-post`).set(admin.auth).expect(200)).body).toEqual({ id: a.id, removed: true });
    const stored = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    expect(stored).toMatchObject({ answer: null, answeredAt: null, deletedAt: null, body: question.body });
    expect((await prisma.report.findMany({ where: { id: { in: [a.id, b.id] } } })).map((r) => r.status)).toEqual(["HANDLED", "HANDLED"]);
    expect(await prisma.questionLog.findMany({ where: { questionId: question.id, action: "DELETED" } })).toMatchObject([{ target: "ANSWER", actorId: admin.id, body: question.answer }]);
    expect(await prisma.adminAction.findMany({ where: { targetId: question.id } })).toMatchObject([{ action: "REMOVE_POST", adminId: admin.id }]);

    expect((await request(url).post(`/admin/reports/${b.id}/remove-post`).set(admin.auth).expect(200)).body).toEqual({ id: b.id, removed: false });
    expect(await prisma.adminAction.count({ where: { targetId: question.id } })).toBe(1);
    await request(url).post("/admin/reports/nope/remove-post").set(admin.auth).expect(404);
  });

  it("removes a reported question and its answer with it, and leaves a newer answer alone when the report was about an older one", async () => {
    const admin = await person("ADMIN");
    const first = await scene();
    const q = await prisma.report.create({ data: { questionId: first.question.id, listingId: first.listing.id, target: "QUESTION", reason: "ABUSE", body: first.question.body, postedAt: first.question.createdAt } });
    await request(url).post(`/admin/reports/${q.id}/remove-post`).set(admin.auth).expect(200);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: first.question.id } })).deletedAt).toBeInstanceOf(Date);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("HANDLED");

    const second = await scene();
    const old = await prisma.report.create({ data: { questionId: second.question.id, listingId: second.listing.id, target: "ANSWER", reason: "SPAM", body: "an older answer", postedAt: new Date(Date.now() - 3600_000) } });
    expect((await request(url).post(`/admin/reports/${old.id}/remove-post`).set(admin.auth).expect(200)).body.removed).toBe(false);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: second.question.id } })).answer).toBe(second.question.answer);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("HANDLED");
  });

  it("strikes whoever wrote the reported post (the asker of a question, the seller for an answer) and closes the reports", async () => {
    const admin = await person("ADMIN");
    const { seller, asker, listing, question } = await scene();
    const reporter = await person();
    const q = await prisma.report.create({ data: { questionId: question.id, listingId: listing.id, target: "QUESTION", reporterId: reporter.id, reason: "CONTACT_DETAILS", body: question.body, postedAt: question.createdAt } });
    const a = await prisma.report.create({ data: { questionId: question.id, listingId: listing.id, target: "ANSWER", reporterId: reporter.id, reason: "SPAM", body: question.answer!, postedAt: question.answeredAt! } });
    await request(url).post(`/admin/reports/${q.id}/strike-author`).set(reporter.auth).expect(403);
    await request(url).post("/admin/reports/nope/strike-author").set(admin.auth).expect(404);

    await request(url).post(`/admin/reports/${q.id}/strike-author`).set(admin.auth).expect(200);
    await request(url).post(`/admin/reports/${a.id}/strike-author`).set(admin.auth).expect(200);
    const [askerStrikes, sellerStrikes] = await Promise.all([prisma.strike.findMany({ where: { userId: asker.id } }), prisma.strike.findMany({ where: { userId: seller.id } })]);
    expect(askerStrikes).toMatchObject([{ listingId: listing.id, givenById: admin.id, reason: expect.stringContaining("Reported question (contact details)") }]);
    expect(askerStrikes[0]!.reason).toContain(question.body);
    expect(sellerStrikes).toMatchObject([{ givenById: admin.id, reason: expect.stringContaining("Reported answer (spam)") }]);
    expect((await prisma.report.findMany({ where: { id: { in: [q.id, a.id] } } })).map((r) => r.status)).toEqual(["HANDLED", "HANDLED"]);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).deletedAt).toBeNull();
    expect(await prisma.adminAction.count({ where: { adminId: admin.id, action: "STRIKE_USER" } })).toBe(2);
  });

  it("refuses to strike when the author's account is gone", async () => {
    const admin = await person("ADMIN");
    const { listing, question } = await scene();
    await prisma.question.update({ where: { id: question.id }, data: { askerId: null } });
    const r = await prisma.report.create({ data: { questionId: question.id, listingId: listing.id, target: "QUESTION", reason: "ABUSE", body: "rude", postedAt: question.createdAt } });
    expect((await request(url).post(`/admin/reports/${r.id}/strike-author`).set(admin.auth).expect(409)).body.code).toBe("NO_AUTHOR");
    expect((await prisma.report.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("OPEN");
  });

  it("finds a person's conversations by username, email or listing title, with the listing's title on each entry", async () => {
    const admin = await person("ADMIN");
    const { seller, asker, listing, question } = await scene();
    const other = await scene();
    await prisma.questionLog.createMany({
      data: [
        { questionId: question.id, listingId: listing.id, target: "QUESTION", action: "CREATED", actorId: asker.id, body: question.body },
        { questionId: question.id, listingId: listing.id, target: "ANSWER", action: "CREATED", actorId: seller.id, body: question.answer! },
        { questionId: other.question.id, listingId: other.listing.id, target: "QUESTION", action: "CREATED", actorId: other.asker.id, body: "elsewhere" },
      ],
    });
    const ids = async (qs: string) => ((await get(`/admin/question-log?q=${encodeURIComponent(qs)}`, admin).expect(200)).body.entries as { questionId: string; listing: { title: string } | null }[]).map((e) => e.questionId);

    // The asker: their question and the seller's answer to it, but nothing from the other listing.
    expect(await ids(asker.username)).toEqual([question.id, question.id]);
    expect(await ids(asker.email.toUpperCase())).toEqual([question.id, question.id]);
    // The seller: their answer, and the whole conversation on the listing they sell.
    expect(await ids(seller.username)).toEqual([question.id, question.id]);
    // The listing, by its title and by its id.
    expect(await ids(listing.title)).toEqual([question.id, question.id]);
    expect(await ids(listing.id)).toEqual([question.id, question.id]);
    expect(await ids(`no-such-${stamp}`)).toEqual([]);
    const entries = (await get(`/admin/question-log?q=${asker.username}`, admin).expect(200)).body.entries;
    expect(entries[0].listing).toEqual({ id: listing.id, title: listing.title });
    await get(`/admin/question-log?q=${"x".repeat(101)}`, admin).expect(400);
  });
});

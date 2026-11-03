import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ANSWER_MAX_LENGTH, QUESTION_MAX_LENGTH, type QuestionItem } from "@auction/shared";
import { SignJWT } from "jose";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { QuestionRetentionService } from "../src/questions/question-retention.service";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;

interface Person {
  id: string;
  token: string;
}

describe("public questions and answers", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let categoryId: string;
  let seller: Person;
  let counter = 0;

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return {
        id: `qa_${stamp}_${n}`,
        email: `qa-${n}-${stamp}@example.com`,
        firstName: "Q",
        lastName: "A",
        username: `qa${n}x${stamp}`,
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
        title: "Question test listing",
        description: "A listing for the question tests.",
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

  const as = (person: Person) => ({ Authorization: `Bearer ${person.token}` });
  const ask = (person: Person, listingId: string, body: unknown = "Does it work?") =>
    request(url).post(`/listings/${listingId}/questions`).set(as(person)).send({ body });
  const answer = (person: Person, id: string, body: unknown = "Yes, it does.") => request(url).post(`/questions/${id}/answer`).set(as(person)).send({ body });
  const items = async (listingId: string) => (await request(url).get(`/listings/${listingId}/questions`).expect(200)).body as { items: QuestionItem[]; total: number };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ async send() {} })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "qa-", endsWith: `-${stamp}@example.com` } };
    await prisma.questionLog.deleteMany({ where: { actorId: { startsWith: `qa_${stamp}_` } } });
    const mineListings = (await prisma.listing.findMany({ where: { seller: mine }, select: { id: true } })).map((l) => l.id);
    await prisma.report.deleteMany({ where: { listingId: { in: mineListings } } });
    await prisma.questionLog.deleteMany({ where: { listingId: { in: mineListings } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  it("lets a signed-in user ask, and everyone read it, newest first", async () => {
    const [anna] = await makePeople(1);
    const listing = await makeListing();
    expect((await items(listing.id))).toEqual({ items: [], total: 0 });
    const first = await ask(anna, listing.id, "  Is it genuine?  ").expect(201);
    expect(first.body).toMatchObject({ body: "Is it genuine?", answer: null, asker: { id: anna.id } });
    await ask(anna, listing.id, "Second one").expect(201);
    const read = await items(listing.id);
    expect(read.total).toBe(2);
    expect(read.items.map((q) => q.body)).toEqual(["Second one", "Is it genuine?"]);
  });

  it("needs sign-in to ask, and refuses empty or too long text", async () => {
    const [anna] = await makePeople(1);
    const listing = await makeListing();
    await request(url).post(`/listings/${listing.id}/questions`).send({ body: "hi" }).expect(401);
    await ask(anna, listing.id, "   ").expect(400);
    await ask(anna, listing.id, "x".repeat(QUESTION_MAX_LENGTH + 1)).expect(400);
    await ask(anna, listing.id, "x".repeat(QUESTION_MAX_LENGTH)).expect(201);
  });

  it("refuses the seller on their own listing, drafts, unknown listings and ended auctions", async () => {
    const [anna] = await makePeople(1);
    const live = await makeListing();
    expect((await ask(seller, live.id).expect(403)).body.code).toBe("OWN_LISTING");
    const draft = await makeListing({ status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    await ask(anna, draft.id).expect(404);
    await request(url).get(`/listings/${draft.id}/questions`).expect(404);
    await ask(anna, "nope").expect(404);
    const ended = await makeListing({ startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - DAY) });
    expect((await ask(anna, ended.id).expect(409)).body.code).toBe("NOT_OPEN");
  });

  it("lets only the seller answer, once", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    const question = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
    expect((await answer(ben, question.id).expect(403)).body.code).toBe("NOT_SELLER");
    expect((await answer(anna, question.id).expect(403)).body.code).toBe("NOT_SELLER");
    await answer(seller, question.id, "").expect(400);
    await answer(seller, question.id, "x".repeat(ANSWER_MAX_LENGTH + 1)).expect(400);
    const done = await answer(seller, question.id, " Yes, it does. ").expect(201);
    expect(done.body.answer).toMatchObject({ body: "Yes, it does." });
    expect((await answer(seller, question.id, "Again").expect(409)).body.code).toBe("ALREADY_ANSWERED");
    expect((await items(listing.id)).items[0].answer?.body).toBe("Yes, it does.");
    await answer(seller, "nope").expect(404);
  });

  it("lets the asker delete their own question while the auction has not ended", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    const mine = (await ask(anna, listing.id, "Mine").expect(201)).body as QuestionItem;
    expect((await request(url).delete(`/questions/${mine.id}`).set(as(ben)).expect(403)).body.code).toBe("NOT_ALLOWED");
    await request(url).delete(`/questions/${mine.id}`).expect(401);
    await request(url).delete(`/questions/${mine.id}`).set(as(anna)).expect(200);
    expect((await items(listing.id))).toEqual({ items: [], total: 0 }); // a deleted question leaves no trace in the list
    await request(url).delete(`/questions/${mine.id}`).set(as(anna)).expect(404);

    const old = (await ask(anna, listing.id, "Old").expect(201)).body as QuestionItem;
    await prisma.question.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 6 * DAY) } });
    await request(url).delete(`/questions/${old.id}`).set(as(anna)).expect(200); // however old the question is

    const late = (await ask(anna, listing.id, "Late").expect(201)).body as QuestionItem;
    await prisma.listing.update({ where: { id: listing.id }, data: { startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - 1000) } });
    expect((await request(url).delete(`/questions/${late.id}`).set(as(anna)).expect(409)).body.code).toBe("NOT_OPEN");
  });

  it("does not let the seller delete a user's question, and hides the answer of one the asker deletes", async () => {
    const [anna] = await makePeople(1);
    const listing = await makeListing();
    const question = (await ask(anna, listing.id, "A fair question").expect(201)).body as QuestionItem;
    await answer(seller, question.id).expect(201);
    expect((await request(url).delete(`/questions/${question.id}`).set(as(seller)).expect(403)).body.code).toBe("NOT_ALLOWED");
    expect((await items(listing.id)).items[0]).toMatchObject({ body: "A fair question" });
    await request(url).delete(`/questions/${question.id}`).set(as(anna)).expect(200);
    expect((await items(listing.id)).items).toEqual([]);
  });

  it("keeps the seller's answer but hides the words when the asker's account is gone", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    const question = (await ask(anna, listing.id, "Private words").expect(201)).body as QuestionItem;
    await answer(seller, question.id, "My reply").expect(201);
    await prisma.user.delete({ where: { id: anna.id } });
    const [shown] = (await items(listing.id)).items;
    expect(shown).toMatchObject({ id: question.id, asker: null, body: null, answer: { body: "My reply" } });
    expect((await items(listing.id)).total).toBe(1);
    await request(url).put(`/questions/${question.id}/vote`).set(as(ben)).send({ target: "ANSWER", value: "LIKE" }).expect(200);
    await prisma.listing.delete({ where: { id: listing.id } });
  });

  it("lets the seller take back an answer while the auction has not ended, which reopens the question", async () => {
    const [anna] = await makePeople(1);
    const listing = await makeListing();
    const question = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
    await request(url).delete(`/questions/${question.id}/answer`).set(as(seller)).expect(404); // nothing to take back
    await answer(seller, question.id).expect(201);
    expect((await request(url).delete(`/questions/${question.id}/answer`).set(as(anna)).expect(403)).body.code).toBe("NOT_SELLER");
    await request(url).delete(`/questions/${question.id}/answer`).set(as(seller)).expect(200);
    expect((await items(listing.id)).items[0].answer).toBeNull();
    await answer(seller, question.id, "Better answer").expect(201);
    await prisma.listing.update({ where: { id: listing.id }, data: { startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - 1000) } });
    expect((await request(url).delete(`/questions/${question.id}/answer`).set(as(seller)).expect(409)).body.code).toBe("NOT_OPEN");
  });

  describe("editing", () => {
    const edit = (person: Person, id: string, body: unknown) => request(url).patch(`/questions/${id}`).set(as(person)).send({ body });
    const editAnswer = (person: Person, id: string, body: unknown) => request(url).patch(`/questions/${id}/answer`).set(as(person)).send({ body });

    it("lets only the asker change their question, marks it edited, and keeps the answer and votes", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id, "Original?").expect(201)).body as QuestionItem;
      expect(q.editedAt).toBeNull();
      await answer(seller, q.id).expect(201);
      await request(url).put(`/questions/${q.id}/vote`).set(as(ben)).send({ target: "QUESTION", value: "LIKE" }).expect(200);

      await request(url).patch(`/questions/${q.id}`).send({ body: "x" }).expect(401);
      expect((await edit(ben, q.id, "Hijack").expect(403)).body.code).toBe("NOT_ALLOWED");
      expect((await edit(seller, q.id, "Hijack").expect(403)).body.code).toBe("NOT_ALLOWED");
      await edit(anna, q.id, "   ").expect(400);
      await edit(anna, q.id, "x".repeat(QUESTION_MAX_LENGTH + 1)).expect(400);

      const done = await edit(anna, q.id, "  Changed?  ").expect(200);
      expect(done.body).toMatchObject({ body: "Changed?", answer: { body: "Yes, it does." }, votes: { question: { likes: 1 } } });
      expect(done.body.editedAt).toEqual(expect.any(String));
      expect((await items(listing.id)).items[0]).toMatchObject({ body: "Changed?", editedAt: done.body.editedAt });
    });

    it("lets only the seller change their answer, marks it edited, and refuses once nothing is there to change", async () => {
      const [anna] = await makePeople(1);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
      expect((await editAnswer(seller, q.id, "Nothing yet").expect(404)).body.code).toBe("NOT_FOUND");
      await answer(seller, q.id, "First").expect(201);
      expect((await editAnswer(anna, q.id, "Hijack").expect(403)).body.code).toBe("NOT_SELLER");
      await editAnswer(seller, q.id, "").expect(400);
      const done = await editAnswer(seller, q.id, "Second").expect(200);
      expect(done.body.answer).toMatchObject({ body: "Second", editedAt: expect.any(String) });
      expect(done.body.editedAt).toBeNull(); // the question itself was not edited
      // A new answer after taking the old one back starts unedited.
      await request(url).delete(`/questions/${q.id}/answer`).set(as(seller)).expect(200);
      await answer(seller, q.id, "Third").expect(201);
      expect((await items(listing.id)).items[0].answer).toMatchObject({ body: "Third", editedAt: null });
    });

    it("does not mark a change that changes nothing as edited, and closes with the auction", async () => {
      const [anna] = await makePeople(1);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id, "Same").expect(201)).body as QuestionItem;
      expect((await edit(anna, q.id, "Same").expect(200)).body.editedAt).toBeNull();
      await answer(seller, q.id, "Same answer").expect(201);
      await prisma.listing.update({ where: { id: listing.id }, data: { startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - 1000) } });
      expect((await edit(anna, q.id, "Too late").expect(409)).body.code).toBe("NOT_OPEN");
      expect((await editAnswer(seller, q.id, "Too late").expect(409)).body.code).toBe("NOT_OPEN");
    });
  });

  describe("the admin log", () => {
    const log = (questionId: string) => prisma.questionLog.findMany({ where: { questionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

    it("records every question and answer as written, each edit with the text before it, and each deletion", async () => {
      const [anna] = await makePeople(1);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id, "First words").expect(201)).body as QuestionItem;
      await request(url).patch(`/questions/${q.id}`).set(as(anna)).send({ body: "Second words" }).expect(200);
      await answer(seller, q.id, "Reply one").expect(201);
      await request(url).patch(`/questions/${q.id}/answer`).set(as(seller)).send({ body: "Reply two" }).expect(200);
      await request(url).delete(`/questions/${q.id}/answer`).set(as(seller)).expect(200);
      await request(url).delete(`/questions/${q.id}`).set(as(anna)).expect(200);

      const rows = await log(q.id);
      expect(rows.map((r) => [r.target, r.action, r.actorId, r.body, r.previousBody])).toEqual([
        ["QUESTION", "CREATED", anna.id, "First words", null],
        ["QUESTION", "EDITED", anna.id, "Second words", "First words"],
        ["ANSWER", "CREATED", seller.id, "Reply one", null],
        ["ANSWER", "EDITED", seller.id, "Reply two", "Reply one"],
        ["ANSWER", "DELETED", seller.id, "Reply two", null],
        ["QUESTION", "DELETED", anna.id, "Second words", null],
      ]);
      expect(rows.every((r) => r.listingId === listing.id)).toBe(true);
    });

    it("writes nothing for refused or unchanged requests, and survives the listing and the asker being deleted", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id, "Keep this record").expect(201)).body as QuestionItem;
      await request(url).patch(`/questions/${q.id}`).set(as(ben)).send({ body: "Nope" }).expect(403);
      await request(url).patch(`/questions/${q.id}`).set(as(anna)).send({ body: "Keep this record" }).expect(200);
      expect(await log(q.id)).toHaveLength(1);
      await prisma.listing.delete({ where: { id: listing.id } });
      await prisma.user.delete({ where: { id: anna.id } });
      expect((await log(q.id))[0]).toMatchObject({ action: "CREATED", body: "Keep this record", actorId: anna.id });
    });
  });

  it("removes a listing's questions when the listing is deleted", async () => {
    const [anna] = await makePeople(1);
    const listing = await makeListing();
    await ask(anna, listing.id).expect(201);
    await prisma.listing.delete({ where: { id: listing.id } });
    expect(await prisma.question.count({ where: { listingId: listing.id } })).toBe(0);
  });

  describe("votes", () => {
    const vote = (person: Person, id: string, target: unknown, value: unknown) => request(url).put(`/questions/${id}/vote`).set(as(person)).send({ target, value });
    const readAs = async (person: Person | null, listingId: string) => {
      const req = request(url).get(`/listings/${listingId}/questions`);
      return ((await (person ? req.set(as(person)) : req).expect(200)).body as { items: QuestionItem[] }).items[0];
    };

    it("counts one like or dislike per person, lets them change or take it back, and shows each reader their own", async () => {
      const [anna, ben, cat] = await makePeople(3);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
      expect(q.votes).toEqual({ question: { likes: 0, dislikes: 0, mine: null }, answer: { likes: 0, dislikes: 0, mine: null } });

      expect((await vote(ben, q.id, "QUESTION", "LIKE").expect(200)).body).toEqual({ likes: 1, dislikes: 0, mine: "LIKE" });
      await vote(ben, q.id, "QUESTION", "LIKE").expect(200); // the same vote twice is still one
      expect((await vote(cat, q.id, "QUESTION", "DISLIKE").expect(200)).body).toEqual({ likes: 1, dislikes: 1, mine: "DISLIKE" });
      expect((await vote(ben, q.id, "QUESTION", "DISLIKE").expect(200)).body).toEqual({ likes: 0, dislikes: 2, mine: "DISLIKE" });
      expect((await vote(ben, q.id, "QUESTION", null).expect(200)).body).toEqual({ likes: 0, dislikes: 1, mine: null });

      expect((await readAs(cat, listing.id)).votes.question).toEqual({ likes: 0, dislikes: 1, mine: "DISLIKE" });
      expect((await readAs(ben, listing.id)).votes.question).toEqual({ likes: 0, dislikes: 1, mine: null });
      expect((await readAs(null, listing.id)).votes.question).toEqual({ likes: 0, dislikes: 1, mine: null });
    });

    it("keeps votes on the question and on its answer apart, and only once there is an answer", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
      expect((await vote(ben, q.id, "ANSWER", "LIKE").expect(404)).body.code).toBe("NOT_FOUND");
      await answer(seller, q.id).expect(201);
      await vote(ben, q.id, "QUESTION", "LIKE").expect(200);
      await vote(ben, q.id, "ANSWER", "DISLIKE").expect(200);
      expect((await readAs(ben, listing.id)).votes).toEqual({
        question: { likes: 1, dislikes: 0, mine: "LIKE" },
        answer: { likes: 0, dislikes: 1, mine: "DISLIKE" },
      });
    });

    it("refuses votes on your own question, from the seller, from signed-out visitors, and with bad input", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
      await answer(seller, q.id).expect(201);
      expect((await vote(anna, q.id, "QUESTION", "LIKE").expect(403)).body.code).toBe("OWN_POST");
      expect((await vote(seller, q.id, "ANSWER", "LIKE").expect(403)).body.code).toBe("SELLER_VOTE");
      expect((await vote(seller, q.id, "QUESTION", "LIKE").expect(403)).body.code).toBe("SELLER_VOTE");
      await vote(anna, q.id, "ANSWER", "LIKE").expect(200);
      await request(url).put(`/questions/${q.id}/vote`).send({ target: "QUESTION", value: "LIKE" }).expect(401);
      await vote(ben, q.id, "OTHER", "LIKE").expect(400);
      await vote(ben, q.id, "QUESTION", "MEH").expect(400);
      await vote(ben, "nope", "QUESTION", "LIKE").expect(404);
    });

    it("refuses a vote on a deleted question, and starts a new answer from no votes", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
      await answer(seller, q.id, "First answer").expect(201);
      await vote(ben, q.id, "ANSWER", "LIKE").expect(200);
      await request(url).delete(`/questions/${q.id}/answer`).set(as(seller)).expect(200);
      await answer(seller, q.id, "Better answer").expect(201);
      expect((await readAs(ben, listing.id)).votes.answer).toEqual({ likes: 0, dislikes: 0, mine: null });
      await request(url).delete(`/questions/${q.id}`).set(as(anna)).expect(200);
      await vote(ben, q.id, "QUESTION", "LIKE").expect(404);
    });
  });

  describe("reports", () => {
    const report = (person: Person, id: string, target: unknown, reason: unknown) => request(url).post(`/questions/${id}/report`).set(as(person)).send({ target, reason });
    const reportsFor = (listingId: string) => prisma.report.findMany({ where: { listingId }, orderBy: { createdAt: "asc" } });

    it("saves a report with the words as they are, once per person and post, and changes nothing on the page", async () => {
      const [anna, ben, cat] = await makePeople(3);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id, "Buy my stuff at spam.example").expect(201)).body as QuestionItem;
      await answer(seller, q.id, "Not interested").expect(201);

      expect((await report(ben, q.id, "QUESTION", "SPAM").expect(201)).body).toEqual({ ok: true });
      expect((await report(ben, q.id, "QUESTION", "ABUSE").expect(409)).body.code).toBe("ALREADY_REPORTED");
      await report(ben, q.id, "ANSWER", "OTHER").expect(201); // the answer is a separate post
      await report(cat, q.id, "QUESTION", "SPAM").expect(201);
      await report(seller, q.id, "QUESTION", "SPAM").expect(201); // the seller may report a buyer's question

      const rows = await reportsFor(listing.id);
      expect(rows.map((r) => [r.target, r.reason, r.reporterId, r.status, r.body])).toEqual([
        ["QUESTION", "SPAM", ben.id, "OPEN", "Buy my stuff at spam.example"],
        ["ANSWER", "OTHER", ben.id, "OPEN", "Not interested"],
        ["QUESTION", "SPAM", cat.id, "OPEN", "Buy my stuff at spam.example"],
        ["QUESTION", "SPAM", seller.id, "OPEN", "Buy my stuff at spam.example"],
      ]);
      expect((await items(listing.id)).items[0]).toMatchObject({ body: "Buy my stuff at spam.example", answer: { body: "Not interested" } });
    });

    it("refuses reports of your own post, missing posts, signed-out visitors and bad input", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
      expect((await report(anna, q.id, "QUESTION", "SPAM").expect(403)).body.code).toBe("SELF_REPORT");
      expect((await report(ben, q.id, "ANSWER", "SPAM").expect(404)).body.code).toBe("NOT_FOUND"); // no answer yet
      await answer(seller, q.id).expect(201);
      expect((await report(seller, q.id, "ANSWER", "SPAM").expect(403)).body.code).toBe("SELF_REPORT");
      await report(anna, q.id, "ANSWER", "OTHER").expect(201); // the asker may report the answer
      await request(url).post(`/questions/${q.id}/report`).send({ target: "QUESTION", reason: "SPAM" }).expect(401);
      await report(ben, q.id, "OTHER", "SPAM").expect(400);
      await report(ben, q.id, "QUESTION", "BORING").expect(400);
      await report(ben, "nope", "QUESTION", "SPAM").expect(404);
      await request(url).delete(`/questions/${q.id}`).set(as(anna)).expect(200);
      await report(ben, q.id, "QUESTION", "SPAM").expect(404); // a deleted question cannot be reported
      expect((await reportsFor(listing.id)).map((r) => r.reporterId)).toEqual([anna.id]);
    });

    it("allows 10 reports a minute from one person", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id).expect(201)).body as QuestionItem;
      await answer(seller, q.id).expect(201);
      const others = await makePeople(10);
      // Ten different questions to report, so no report is turned away as a repeat.
      const posts: QuestionItem[] = [];
      for (let i = 0; i < 11; i++) posts.push((await ask(others[i % 10], listing.id, `Question ${i}`).expect(201)).body as QuestionItem);
      for (let i = 0; i < 10; i++) await report(ben, posts[i].id, "QUESTION", "SPAM").expect(201);
      expect((await report(ben, posts[10].id, "QUESTION", "SPAM").expect(429)).body.code).toBe("RATE_LIMITED");
    });
  });

  describe("contact details", () => {
    const flagged = (listingId: string) => prisma.report.findMany({ where: { listingId, reporterId: null }, orderBy: { createdAt: "asc" } });

    it("reports a question or answer with an email address or phone number, without blocking it", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      const clean = (await ask(anna, listing.id, "Is it 100% genuine, bought 2026-11-03 for 1,500 euros?").expect(201)).body as QuestionItem;
      expect(await flagged(listing.id)).toEqual([]);
      const asked = (await ask(ben, listing.id, "Mail me at ben@example.com").expect(201)).body as QuestionItem;
      expect(asked.body).toBe("Mail me at ben@example.com"); // still published
      await answer(seller, asked.id, "Call me on +383 44 123 456").expect(201);
      await answer(seller, clean.id, "Yes it is.").expect(201);

      const rows = await flagged(listing.id);
      expect(rows.map((r) => [r.target, r.reason, r.status, r.body])).toEqual([
        ["QUESTION", "CONTACT_DETAILS", "OPEN", "Mail me at ben@example.com"],
        ["ANSWER", "CONTACT_DETAILS", "OPEN", "Call me on +383 44 123 456"],
      ]);
    });

    it("checks edits too, keeping one open report per post and updating its words", async () => {
      const [anna] = await makePeople(1);
      const listing = await makeListing();
      const q = (await ask(anna, listing.id, "A harmless question").expect(201)).body as QuestionItem;
      await request(url).patch(`/questions/${q.id}`).set(as(anna)).send({ body: "Text me 044 123 456 78" }).expect(200);
      await request(url).patch(`/questions/${q.id}`).set(as(anna)).send({ body: "Text me 044 123 456 79 now" }).expect(200);
      const rows = await flagged(listing.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].body).toBe("Text me 044 123 456 79 now");
      await answer(seller, q.id, "Write to shop@example.org").expect(201);
      await request(url).patch(`/questions/${q.id}/answer`).set(as(seller)).send({ body: "Visit our site instead" }).expect(200);
      expect((await flagged(listing.id)).map((r) => r.target)).toEqual(["QUESTION", "ANSWER"]);
    });
  });

  describe("asking too fast", () => {
    it("allows 10 questions a minute from one person, then answers 429, and other people are not held back", async () => {
      const [anna, ben] = await makePeople(2);
      const listing = await makeListing();
      for (let i = 0; i < 10; i++) await ask(anna, listing.id, `Question ${i}`).expect(201);
      const refused = await ask(anna, listing.id, "One too many").expect(429);
      expect(refused.body.code).toBe("RATE_LIMITED");
      expect((await items(listing.id)).total).toBe(10);
      await ask(ben, listing.id, "Still fine").expect(201);
    });

    it("does not count a refused question against the limit", async () => {
      const [anna] = await makePeople(1);
      const ended = await makeListing({ startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - 1000) });
      const live = await makeListing();
      for (let i = 0; i < 12; i++) await ask(anna, ended.id).expect(409);
      await ask(anna, live.id).expect(201);
    });
  });

  describe("keeping the record for a month", () => {
    const retention = () => app.get(QuestionRetentionService);
    const endedAgo = (days: number) => makeListing({ startsAt: new Date(Date.now() - (days + 3) * DAY), endsAt: new Date(Date.now() - days * DAY) });

    it("removes the log of an auction that ended over 30 days ago, and what its askers deleted, but keeps newer ones and all reports", async () => {
      const [anna] = await makePeople(1);
      const old = await endedAgo(31);
      const recent = await endedAgo(29);
      const live = await makeListing();
      const mk = async (listingId: string, body: string, deleted = false) => {
        const q = await prisma.question.create({ data: { listingId, askerId: anna.id, body, deletedAt: deleted ? new Date() : null } });
        await prisma.questionLog.create({ data: { questionId: q.id, listingId, target: "QUESTION", action: "CREATED", actorId: anna.id, body } });
        return q;
      };
      const oldKept = await mk(old.id, "old and shown");
      const oldDeleted = await mk(old.id, "old and deleted", true);
      const recentDeleted = await mk(recent.id, "recent and deleted", true);
      const liveDeleted = await mk(live.id, "live and deleted", true);
      await prisma.report.create({ data: { questionId: oldKept.id, listingId: old.id, target: "QUESTION", reporterId: anna.id, reason: "SPAM", body: "old and shown" } });

      await retention().purge();

      const logged = async (listingId: string) => (await prisma.questionLog.findMany({ where: { listingId } })).length;
      expect([await logged(old.id), await logged(recent.id), await logged(live.id)]).toEqual([0, 1, 1]);
      expect(await prisma.question.findUnique({ where: { id: oldDeleted.id } })).toBeNull();
      expect(await prisma.question.findUnique({ where: { id: oldKept.id } })).not.toBeNull(); // still on the page
      expect(await prisma.question.findUnique({ where: { id: recentDeleted.id } })).not.toBeNull();
      expect(await prisma.question.findUnique({ where: { id: liveDeleted.id } })).not.toBeNull();
      expect(await prisma.report.count({ where: { listingId: old.id } })).toBe(1);
    });

    it("counts log entries whose listing is gone from when they were written", async () => {
      const gone = `gone_${stamp}`;
      await prisma.questionLog.createMany({
        data: [
          { questionId: "q-old", listingId: gone, target: "QUESTION", action: "CREATED", actorId: `qa_${stamp}_x`, body: "old", createdAt: new Date(Date.now() - 31 * DAY) },
          { questionId: "q-new", listingId: gone, target: "QUESTION", action: "CREATED", actorId: `qa_${stamp}_x`, body: "new", createdAt: new Date(Date.now() - 5 * DAY) },
        ],
      });
      await retention().purge();
      expect((await prisma.questionLog.findMany({ where: { listingId: gone } })).map((r) => r.body)).toEqual(["new"]);
    });
  });
});

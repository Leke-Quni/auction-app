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
});

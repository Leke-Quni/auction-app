import { QUESTION_REFUSAL_MESSAGES, type QuestionItem, type QuestionRefusal, type VoteSummary, type VoteTarget, type VoteValue } from "@auction/shared";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { QuestionEvents } from "./question-events";

const STATUS: Record<QuestionRefusal, HttpStatus> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  OWN_LISTING: HttpStatus.FORBIDDEN,
  NOT_OPEN: HttpStatus.CONFLICT,
  NOT_SELLER: HttpStatus.FORBIDDEN,
  NOT_ALLOWED: HttpStatus.FORBIDDEN,
  ALREADY_ANSWERED: HttpStatus.CONFLICT,
  OWN_POST: HttpStatus.FORBIDDEN,
  SELLER_VOTE: HttpStatus.FORBIDDEN,
};

const refuse = (code: QuestionRefusal) => new HttpException({ code, message: QUESTION_REFUSAL_MESSAGES[code] }, STATUS[code]);


interface QuestionRow {
  id: string;
  body: string;
  createdAt: Date;
  answer: string | null;
  answeredAt: Date | null;
  editedAt: Date | null;
  answerEditedAt: Date | null;
  asker: { id: string; username: string } | null;
}

const noVotes = (): VoteSummary => ({ likes: 0, dislikes: 0, mine: null });
type VoteSummaries = QuestionItem["votes"];

// A question whose asker's account is gone keeps its place and its answer, but not its words.
const toItem = (row: QuestionRow, votes: VoteSummaries): QuestionItem => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  asker: row.asker,
  body: row.asker ? row.body : null,
  editedAt: row.editedAt?.toISOString() ?? null,
  answer: row.answer && row.answeredAt ? { body: row.answer, answeredAt: row.answeredAt.toISOString(), editedAt: row.answerEditedAt?.toISOString() ?? null } : null,
  votes,
});

const include = { asker: { select: { id: true, username: true } } } as const;

@Injectable()
export class QuestionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly events: QuestionEvents,
  ) {}

  async list(listingId: string, limit: number, viewerId?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { status: true } });
    if (!listing || listing.status !== "PUBLISHED") throw refuse("NOT_FOUND");
    const [rows, total] = await Promise.all([
      this.prisma.question.findMany({ where: { listingId, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, include }),
      this.prisma.question.count({ where: { listingId, deletedAt: null } }),
    ]);
    const votes = await this.votesFor(rows.map((r) => r.id), viewerId);
    return { items: rows.map((row) => toItem(row, votes.get(row.id) ?? { question: noVotes(), answer: noVotes() })), total };
  }

  async ask(userId: string, listingId: string, body: string): Promise<QuestionItem> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { status: true, sellerId: true, endsAt: true } });
    if (!listing || listing.status !== "PUBLISHED" || !listing.endsAt) throw refuse("NOT_FOUND");
    if (listing.sellerId === userId) throw refuse("OWN_LISTING");
    if (listing.endsAt.getTime() <= Date.now()) throw refuse("NOT_OPEN");
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.question.create({ data: { listingId, askerId: userId, body }, include });
      await tx.questionLog.create({ data: { questionId: created.id, listingId, target: "QUESTION", action: "CREATED", actorId: userId, body } });
      return created;
    });
    this.events.publish({ type: "QuestionAsked", questionId: row.id, listingId, askerId: userId, body });
    return toItem(row, { question: noVotes(), answer: noVotes() });
  }

  async answer(userId: string, questionId: string, body: string): Promise<QuestionItem> {
    const question = await this.find(questionId);
    if (question.listing.sellerId !== userId) throw refuse("NOT_SELLER");
    if (question.answer !== null) throw refuse("ALREADY_ANSWERED");
    // Only the first of two answers at the same moment is saved.
    const saved = await this.prisma.$transaction(async (tx) => {
      const result = await tx.question.updateMany({ where: { id: questionId, answer: null, deletedAt: null }, data: { answer: body, answeredAt: new Date(), answerEditedAt: null } });
      if (result.count === 1) await tx.questionLog.create({ data: { questionId, listingId: question.listingId, target: "ANSWER", action: "CREATED", actorId: userId, body } });
      return result.count;
    });
    if (saved === 0) throw refuse("ALREADY_ANSWERED");
    const row = await this.prisma.question.findUniqueOrThrow({ where: { id: questionId }, include });
    if (row.askerId) this.events.publish({ type: "QuestionAnswered", questionId, listingId: question.listingId, askerId: row.askerId, sellerId: userId, body });
    return toItem(row, await this.votesOne(questionId, userId));
  }

  // One vote per person on the question and one on its answer. `null` takes a vote back. The seller does not vote at all,
  // and the asker does not vote on their own question.
  async vote(userId: string, questionId: string, target: VoteTarget, value: VoteValue | null): Promise<VoteSummary> {
    const question = await this.find(questionId);
    if (target === "ANSWER" && question.answer === null) throw refuse("NOT_FOUND");
    if (question.listing.sellerId === userId) throw refuse("SELLER_VOTE");
    if (target === "QUESTION" && question.askerId === userId) throw refuse("OWN_POST");
    const key = { questionId_userId_target: { questionId, userId, target } };
    if (value === null) await this.prisma.questionVote.deleteMany({ where: { questionId, userId, target } });
    else {
      const liked = value === "LIKE";
      await this.prisma.questionVote.upsert({ where: key, create: { questionId, userId, target, liked }, update: { liked } });
    }
    return (await this.votesFor([questionId], userId)).get(questionId)?.[target === "QUESTION" ? "question" : "answer"] ?? noVotes();
  }

  private async votesFor(questionIds: string[], viewerId?: string): Promise<Map<string, VoteSummaries>> {
    const result = new Map<string, VoteSummaries>();
    if (questionIds.length === 0) return result;
    const [counts, mine] = await Promise.all([
      this.prisma.questionVote.groupBy({ by: ["questionId", "target", "liked"], where: { questionId: { in: questionIds } }, _count: { _all: true } }),
      viewerId ? this.prisma.questionVote.findMany({ where: { questionId: { in: questionIds }, userId: viewerId } }) : [],
    ]);
    const slot = (id: string, target: VoteTarget) => {
      let entry = result.get(id);
      if (!entry) result.set(id, (entry = { question: noVotes(), answer: noVotes() }));
      return entry[target === "QUESTION" ? "question" : "answer"];
    };
    for (const c of counts) slot(c.questionId, c.target)[c.liked ? "likes" : "dislikes"] = c._count._all;
    for (const v of mine) slot(v.questionId, v.target).mine = v.liked ? "LIKE" : "DISLIKE";
    return result;
  }

  private async votesOne(questionId: string, viewerId: string) {
    return (await this.votesFor([questionId], viewerId)).get(questionId) ?? { question: noVotes(), answer: noVotes() };
  }

  // Only the asker may change or delete their question, and only while the auction has not ended. The seller cannot
  // remove or change a buyer's question. Every change is written to the log with the text before it.
  async editQuestion(userId: string, questionId: string, body: string): Promise<QuestionItem> {
    const question = await this.find(questionId);
    if (question.askerId !== userId) throw refuse("NOT_ALLOWED");
    this.ensureOpen(question.listing);
    if (body !== question.body) {
      const saved = await this.prisma.$transaction(async (tx) => {
        const result = await tx.question.updateMany({ where: { id: questionId, deletedAt: null }, data: { body, editedAt: new Date() } });
        if (result.count === 1) await tx.questionLog.create({ data: { questionId, listingId: question.listingId, target: "QUESTION", action: "EDITED", actorId: userId, body, previousBody: question.body } });
        return result.count;
      });
      if (saved === 0) throw refuse("NOT_FOUND");
    }
    return this.read(questionId, userId);
  }

  async deleteQuestion(userId: string, questionId: string) {
    const question = await this.find(questionId);
    if (question.askerId !== userId) throw refuse("NOT_ALLOWED");
    this.ensureOpen(question.listing);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.question.updateMany({ where: { id: questionId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (result.count === 1) await tx.questionLog.create({ data: { questionId, listingId: question.listingId, target: "QUESTION", action: "DELETED", actorId: userId, body: question.body } });
    });
    return { ok: true };
  }

  // The seller may change an answer, or take it back (which leaves the question open again), while the auction has not ended.
  async editAnswer(userId: string, questionId: string, body: string): Promise<QuestionItem> {
    const question = await this.find(questionId);
    if (question.listing.sellerId !== userId) throw refuse("NOT_SELLER");
    if (question.answer === null) throw refuse("NOT_FOUND");
    this.ensureOpen(question.listing);
    if (body !== question.answer) {
      const saved = await this.prisma.$transaction(async (tx) => {
        const result = await tx.question.updateMany({ where: { id: questionId, answer: { not: null } }, data: { answer: body, answerEditedAt: new Date() } });
        if (result.count === 1) await tx.questionLog.create({ data: { questionId, listingId: question.listingId, target: "ANSWER", action: "EDITED", actorId: userId, body, previousBody: question.answer } });
        return result.count;
      });
      if (saved === 0) throw refuse("NOT_FOUND");
    }
    return this.read(questionId, userId);
  }

  async deleteAnswer(userId: string, questionId: string) {
    const question = await this.find(questionId);
    if (question.listing.sellerId !== userId) throw refuse("NOT_SELLER");
    if (question.answer === null) throw refuse("NOT_FOUND");
    this.ensureOpen(question.listing);
    const answer = question.answer;
    // The votes were for that answer, so a new answer starts from none.
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.question.updateMany({ where: { id: questionId, answer: { not: null } }, data: { answer: null, answeredAt: null, answerEditedAt: null } });
      if (result.count === 1) {
        await tx.questionVote.deleteMany({ where: { questionId, target: "ANSWER" } });
        await tx.questionLog.create({ data: { questionId, listingId: question.listingId, target: "ANSWER", action: "DELETED", actorId: userId, body: answer } });
      }
    });
    return { ok: true };
  }

  // Changes and deletions are only open until the auction ends (it may still be upcoming).
  private ensureOpen(listing: { status: string; endsAt: Date | null }) {
    if (listing.status !== "PUBLISHED" || !listing.endsAt || listing.endsAt.getTime() <= Date.now()) throw refuse("NOT_OPEN");
  }

  private async read(questionId: string, viewerId: string) {
    const row = await this.prisma.question.findUniqueOrThrow({ where: { id: questionId }, include });
    return toItem(row, await this.votesOne(questionId, viewerId));
  }

  private async find(questionId: string) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId }, include: { listing: { select: { sellerId: true, status: true, endsAt: true } } } });
    if (!question || question.deletedAt) throw refuse("NOT_FOUND");
    return question;
  }
}

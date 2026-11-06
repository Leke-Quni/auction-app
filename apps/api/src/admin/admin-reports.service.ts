import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { giveAdminStrike } from "./admin-strikes";
import { PRISMA, type Prisma } from "../db/db.module";

export interface ReportListQuery {
  status: "OPEN" | "HANDLED";
  limit: number;
}

export interface QuestionLogQuery {
  questionId?: string;
  listingId?: string;
  actorId?: string;
  q?: string;
  limit: number;
}

// What the admin app reads to moderate questions and answers. Reports and the log have no foreign keys, so the people and
// listings they point to are looked up here and shown as null when they are gone.
@Injectable()
export class AdminReportsService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async listReports({ status, limit }: ReportListQuery) {
    const [rows, openCount] = await Promise.all([
      this.prisma.report.findMany({ where: { status }, orderBy: [{ createdAt: status === "OPEN" ? "asc" : "desc" }, { id: "asc" }], take: limit }),
      this.prisma.report.count({ where: { status: "OPEN" } }),
    ]);
    const questions = await this.prisma.question.findMany({ where: { id: { in: rows.map((r) => r.questionId) } }, select: { id: true, askerId: true } });
    const listings = await this.prisma.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) } }, select: { id: true, title: true, sellerId: true } });
    const askerOf = new Map(questions.map((q) => [q.id, q.askerId]));
    const listingOf = new Map(listings.map((l) => [l.id, l]));
    // Whoever wrote the reported post: the asker for a question, the listing's seller for an answer.
    const authorId = (r: (typeof rows)[number]) => (r.target === "QUESTION" ? askerOf.get(r.questionId) : listingOf.get(r.listingId)?.sellerId) ?? null;
    const people = await this.usernames(rows.flatMap((r) => [r.reporterId, authorId(r)]));
    const person = (id: string | null) => (id ? { id, username: people.get(id) ?? null } : null);
    return {
      openCount,
      reports: rows.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        target: r.target,
        body: r.body,
        postedAt: r.postedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        handledAt: r.handledAt?.toISOString() ?? null,
        questionId: r.questionId,
        listing: listingOf.has(r.listingId) ? { id: r.listingId, title: listingOf.get(r.listingId)!.title } : null,
        reporter: person(r.reporterId),
        author: person(authorId(r)),
      })),
    };
  }

  // Marking a handled report handled again changes nothing, so a double click is harmless.
  async handleReport(id: string) {
    await this.prisma.report.updateMany({ where: { id, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date() } });
    // Read after the update; a handled report may be deleted by the 30-day clean-up in between, which is the same as unknown.
    const report = await this.prisma.report.findUnique({ where: { id }, select: { id: true, status: true, handledAt: true } });
    if (!report) throw new NotFoundException();
    return { id: report.id, status: report.status, handledAt: report.handledAt?.toISOString() ?? null };
  }

  // Takes the reported question or answer down and closes every open report about that same post, all in one transaction.
  // A question is deleted the way its asker deletes it (the answer under it goes with it); an answer is taken back, which
  // leaves the question open again. If the post is already gone or was replaced by a newer one, nothing is removed and the
  // reports are just closed, so a double click or a stale page is harmless. Works after the auction has ended.
  async removePost(adminId: string, reportId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException();
    const removed = await this.prisma.$transaction(async (tx) => {
      const question = await tx.question.findUnique({ where: { id: report.questionId } });
      let removed = false;
      if (question && !question.deletedAt) {
        if (report.target === "QUESTION") {
          const result = await tx.question.updateMany({ where: { id: question.id, deletedAt: null }, data: { deletedAt: new Date() } });
          removed = result.count === 1;
          if (removed) await tx.questionLog.create({ data: { questionId: question.id, listingId: question.listingId, target: "QUESTION", action: "DELETED", actorId: adminId, body: question.body } });
        } else if (question.answer !== null && question.answeredAt?.getTime() === report.postedAt.getTime()) {
          const result = await tx.question.updateMany({ where: { id: question.id, deletedAt: null, answer: question.answer, answeredAt: question.answeredAt }, data: { answer: null, answeredAt: null, answerEditedAt: null } });
          removed = result.count === 1;
          if (removed) {
            await tx.questionVote.deleteMany({ where: { questionId: question.id, target: "ANSWER" } });
            await tx.questionLog.create({ data: { questionId: question.id, listingId: question.listingId, target: "ANSWER", action: "DELETED", actorId: adminId, body: question.answer } });
          }
        }
      }
      await tx.report.updateMany({ where: { questionId: report.questionId, target: report.target, postedAt: report.postedAt, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date() } });
      if (removed) await tx.adminAction.create({ data: { adminId, action: "REMOVE_POST", targetId: report.questionId, reason: `${report.target === "QUESTION" ? "Question" : "Answer"}, report ${report.id}` } });
      return removed;
    });
    return { id: report.id, removed };
  }

  // A strike for whoever wrote the reported post (the asker of a question, the seller for an answer), with the report's reason
  // and the listing as its reason, then the reports about that post are closed. The post itself is left as it is: removing it is
  // a separate button, so an admin can do either or both. Refused when the author's account is gone or is an admin.
  async strikeAuthor(adminId: string, reportId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException();
    const [question, listing] = await Promise.all([
      this.prisma.question.findUnique({ where: { id: report.questionId }, select: { askerId: true } }),
      this.prisma.listing.findUnique({ where: { id: report.listingId }, select: { sellerId: true, title: true } }),
    ]);
    const authorId = report.target === "QUESTION" ? question?.askerId : listing?.sellerId;
    if (!authorId) throw new ConflictException({ code: "NO_AUTHOR", message: "The account that wrote this is gone, so there is nobody to strike." });
    const what = report.target === "QUESTION" ? "question" : "answer";
    const reason = `Reported ${what} (${report.reason.toLowerCase().replace("_", " ")})${listing ? ` on "${listing.title}"` : ""}: ${report.body}`.slice(0, 500);
    await this.prisma.$transaction(async (tx) => {
      await giveAdminStrike(tx, adminId, authorId, reason, report.listingId);
      await tx.report.updateMany({ where: { questionId: report.questionId, target: report.target, postedAt: report.postedAt, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date() } });
    });
    return { id: report.id, userId: authorId };
  }

  // The conversations on listings. `q` finds a person's whole part in them: what they wrote, the answers to their questions, and
  // everything said on the listings they sell, matching a username, an email, an id or part of a listing title. The other
  // filters are exact. The log has no foreign keys, so people and listings are looked up here and shown as null when gone.
  async questionLog({ questionId, listingId, actorId, q, limit }: QuestionLogQuery) {
    const term = q?.trim();
    let match: { OR: Record<string, unknown>[] } | undefined;
    if (term) {
      const userIds = (await this.prisma.user.findMany({ where: { OR: [{ username: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { id: term }] }, select: { id: true }, take: 50 })).map((u) => u.id);
      const [listings, asked] = await Promise.all([
        this.prisma.listing.findMany({ where: { OR: [{ id: term }, { title: { contains: term, mode: "insensitive" } }, { sellerId: { in: userIds } }] }, select: { id: true }, take: 200 }),
        this.prisma.question.findMany({ where: { askerId: { in: userIds } }, select: { id: true }, take: 500 }),
      ]);
      match = { OR: [{ actorId: { in: userIds } }, { listingId: { in: listings.map((l) => l.id) } }, { questionId: { in: [term, ...asked.map((a) => a.id)] } }] };
    }
    const rows = await this.prisma.questionLog.findMany({
      where: { questionId, listingId, actorId, ...match },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    const people = await this.usernames(rows.map((r) => r.actorId));
    const titles = new Map((await this.prisma.listing.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.listingId))] } }, select: { id: true, title: true } })).map((l) => [l.id, l.title]));
    return {
      entries: rows.map((r) => ({
        id: r.id,
        questionId: r.questionId,
        listingId: r.listingId,
        listing: titles.has(r.listingId) ? { id: r.listingId, title: titles.get(r.listingId)! } : null,
        target: r.target,
        action: r.action,
        body: r.body,
        previousBody: r.previousBody,
        createdAt: r.createdAt.toISOString(),
        actor: r.actorId ? { id: r.actorId, username: people.get(r.actorId) ?? null } : null,
      })),
    };
  }

  private async usernames(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, username: true } });
    return new Map(users.map((u) => [u.id, u.username]));
  }
}

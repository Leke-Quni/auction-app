import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";

export interface ReportListQuery {
  status: "OPEN" | "HANDLED";
  limit: number;
}

export interface QuestionLogQuery {
  questionId?: string;
  listingId?: string;
  actorId?: string;
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
    const done = await this.prisma.report.updateMany({ where: { id, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date() } });
    if (done.count === 0 && !(await this.prisma.report.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException();
    const report = await this.prisma.report.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, handledAt: true } });
    return { id: report.id, status: report.status, handledAt: report.handledAt?.toISOString() ?? null };
  }

  async questionLog({ questionId, listingId, actorId, limit }: QuestionLogQuery) {
    const rows = await this.prisma.questionLog.findMany({
      where: { questionId, listingId, actorId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    const people = await this.usernames(rows.map((r) => r.actorId));
    return {
      entries: rows.map((r) => ({
        id: r.id,
        questionId: r.questionId,
        listingId: r.listingId,
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

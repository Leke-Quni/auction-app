import { QUESTION_LOG_RETENTION_DAYS } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";

const DAY_MS = 24 * 3600_000;
const PURGE_EVERY_MS = 60 * 60_000;

// Keeps the record of questions and answers for complaints, and no longer than needed: once an auction has been over for
// QUESTION_LOG_RETENTION_DAYS, its entries in QuestionLog and the questions their askers deleted are removed. Reports are
// never removed here, since a moderator may not have read them yet. Entries whose listing is gone are counted from when
// they were written.
@Injectable()
export class QuestionRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QuestionRetentionService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  onModuleInit() {
    void this.purge();
    this.timer = setInterval(() => void this.purge(), PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async purge(now = new Date()) {
    const cutoff = new Date(now.getTime() - QUESTION_LOG_RETENTION_DAYS * DAY_MS);
    try {
      const entries = await this.prisma.$executeRaw`
        DELETE FROM "QuestionLog" ql
        WHERE EXISTS (SELECT 1 FROM "Listing" l WHERE l."id" = ql."listingId" AND l."endsAt" < ${cutoff})
           OR (NOT EXISTS (SELECT 1 FROM "Listing" l WHERE l."id" = ql."listingId") AND ql."createdAt" < ${cutoff})`;
      const questions = await this.prisma.$executeRaw`
        DELETE FROM "Question" q USING "Listing" l
        WHERE q."listingId" = l."id" AND q."deletedAt" IS NOT NULL AND l."endsAt" < ${cutoff}`;
      if (entries + questions > 0) this.log.log(`Removed ${entries} log entries and ${questions} deleted questions older than ${QUESTION_LOG_RETENTION_DAYS} days`);
      return { entries, questions };
    } catch (error) {
      this.log.error(`Could not remove old question records: ${(error as Error).message}`);
      return { entries: 0, questions: 0 };
    }
  }
}

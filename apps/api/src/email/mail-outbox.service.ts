import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { AuctionEvents } from "../bids/auction-events";
import { PRISMA, type Prisma } from "../db/db.module";
import { runEvery } from "../jobs/sweep-support";
import { MAIL_SENDER, type MailSender } from "./mail-sender";
import type { OutboxKind } from "./mail-outbox";
import { sendOutboxMail } from "./outbox-messages";

const SWEEP_EVERY_MS = 30_000;
// A send holds its row this long; if the machine stops mid-send the row comes due again afterwards.
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
// Reminders are the least urgent mail, so a sweep sends only a few; a burst of them (everyone watching one popular auction)
// never holds up the pay-now and payment emails that share this queue, and the rest go out on the next sweeps.
const REMINDER_BATCH = 25;

// Sends the emails the app owes (see queueMail and outbox-messages). The rows are written in the transaction that makes them
// owed, so this only has to send what is due: a row is claimed by moving its due time
// out (a lease) and deleted only after the email has gone, so a failed send or a machine that stopped mid-send is tried
// again, up to MAX_ATTEMPTS times. Safe to run on several machines.
@Injectable()
export class MailOutbox implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MailOutbox.name);
  private stop?: () => void;
  private subscription?: Subscription;
  private running?: Promise<void>;
  private again = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    private readonly events: AuctionEvents,
  ) {}

  onModuleInit() {
    this.stop = runEvery(SWEEP_EVERY_MS, () => this.sweep());
    void this.sweep();
    this.subscription = this.events.stream.subscribe((event) => {
      if (event.type === "AuctionClosed" || event.type === "OrderExpired") void this.sweep();
    });
  }

  onModuleDestroy() {
    this.stop?.();
    this.subscription?.unsubscribe();
  }

  // A call while a sweep is under way makes it go round once more when it finishes (rows written after it started would
  // otherwise wait for the next timer), and resolves when that is done.
  sweep(): Promise<void> {
    this.again = this.running !== undefined;
    this.running ??= this.loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async loop() {
    do {
      this.again = false;
      await this.run();
    } while (this.again);
  }

  private async run() {
    try {
      const now = new Date();
      const [urgent, reminders] = await Promise.all([
        this.prisma.pendingEndEmail.findMany({ where: { dueAt: { lte: now }, kind: { not: "ENDING_SOON" } }, orderBy: { dueAt: "asc" }, take: 100 }),
        this.prisma.pendingEndEmail.findMany({ where: { dueAt: { lte: now }, kind: "ENDING_SOON" }, orderBy: { dueAt: "asc" }, take: REMINDER_BATCH }),
      ]);
      for (const candidate of [...urgent, ...reminders]) {
        const claimed = await this.prisma.$queryRaw<{ id: string; userId: string; listingId: string; kind: OutboxKind; attempts: number }[]>`
          UPDATE "PendingEndEmail" SET "dueAt" = clock_timestamp() + (${LEASE_MS}::int * interval '1 millisecond'), "attempts" = "attempts" + 1
          WHERE "id" = ${candidate.id} AND "dueAt" <= clock_timestamp()
          RETURNING "id", "userId", "listingId", "kind", "attempts"`;
        const pending = claimed[0];
        if (!pending) continue; // another machine got it
        if (pending.attempts > MAX_ATTEMPTS) {
          this.log.error(`Giving up on an auction-ended email for ${pending.userId} on ${pending.listingId} after ${MAX_ATTEMPTS} tries`);
          await this.prisma.pendingEndEmail.deleteMany({ where: { id: pending.id } });
          continue;
        }
        try {
          await sendOutboxMail({ prisma: this.prisma, mail: this.mail }, pending.userId, pending.listingId, pending.kind);
          await this.prisma.pendingEndEmail.deleteMany({ where: { id: pending.id } });
        } catch (error) {
          this.log.error(`Could not email an auction-ended notice (try ${pending.attempts} of ${MAX_ATTEMPTS}): ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.log.error(`Could not sweep auction-ended emails: ${(error as Error).message}`);
    }
  }
}

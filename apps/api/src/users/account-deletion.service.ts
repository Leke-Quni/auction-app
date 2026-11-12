import {
  ACCOUNT_DELETION_GRACE_DAYS,
  type AccountDeletionStatus,
  type ConfirmAccountDeletionInput,
  type DeletionBlocker,
  type StartAccountDeletionInput,
} from "@auction/shared";
import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { Prisma as PrismaRuntime } from "@auction/db";
import { AuctionCloseService } from "../auctions/auction-close.service";
import { CODE_TTL_MS, generateCode, hashCode, MAX_CODE_ATTEMPTS, sameHash } from "../auth/codes";
import { loginCodeCooldownSeconds } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { runEvery } from "../jobs/sweep-support";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";
import { SEARCH_INDEX, type SearchIndex } from "../search/search-index";
import { emailFingerprint } from "./email-fingerprint";

const DAY_MS = 86_400_000;
const SWEEP_EVERY_MS = 60 * 60_000;
const SWEEP_BATCH = 50;
const CODE_RATE_LIMIT = { limit: 5, windowSeconds: 3600 };
const scope = (userId: string) => `account-deletion:${userId}`;

// Deleting an account is closing it first: the person is shut out of everything but looking at it and restoring it, for
// ACCOUNT_DELETION_GRACE_DAYS, and then it is anonymised for good (finalize). Anything other people depend on (bids, orders,
// ratings) is kept, shown as "Deleted user", so an account with such things open cannot be closed until they are done.
@Injectable()
export class AccountDeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AccountDeletionService.name);
  private stop?: () => void;
  private sweeping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(SEARCH_INDEX) private readonly search: SearchIndex,
    private readonly closer: AuctionCloseService,
  ) {}

  onModuleInit() {
    this.stop = runEvery(SWEEP_EVERY_MS, () => this.sweep());
  }

  onModuleDestroy() {
    this.stop?.();
  }

  // What stops this account being deleted yet: an auction of theirs that has bids, an auction they are winning, a purchase that is not
  // delivered yet, a sale that is not paid out yet. Unbid auctions and drafts do not stop it: they are ended or deleted with the account.
  async blockers(userId: string): Promise<DeletionBlocker[]> {
    const [selling, leading, purchases, sales] = await Promise.all([
      this.prisma.listing.findMany({ where: { sellerId: userId, status: "PUBLISHED", closedAt: null, bidCount: { gt: 0 } }, select: { id: true, title: true } }),
      this.prisma.listing.findMany({ where: { highBidderId: userId, status: "PUBLISHED", closedAt: null }, select: { id: true, title: true } }),
      this.prisma.order.findMany({
        where: { buyerId: userId, OR: [{ status: "AWAITING_PAYMENT" }, { status: "PAID", OR: [{ shipmentStatus: null }, { shipmentStatus: { not: "DELIVERED" } }] }] },
        select: { id: true, listingId: true, status: true, listing: { select: { title: true } } },
      }),
      this.prisma.order.findMany({
        where: { sellerId: userId, OR: [{ status: "AWAITING_PAYMENT" }, { status: "PAID", payout: null }] },
        select: { id: true, listingId: true, status: true, shipmentStatus: true, listing: { select: { title: true } } },
      }),
    ]);
    return [
      ...selling.map((l): DeletionBlocker => ({ kind: "LIVE_AUCTION_WITH_BIDS", title: l.title, listingId: l.id, text: "Your auction has bids. Wait for it to end." })),
      ...leading.map((l): DeletionBlocker => ({ kind: "HIGH_BIDDER", title: l.title, listingId: l.id, text: "You are the highest bidder. Wait for the auction to end." })),
      ...purchases.map((o): DeletionBlocker => ({
        kind: "PURCHASE_IN_PROGRESS",
        title: o.listing.title,
        listingId: o.listingId,
        orderId: o.id,
        text: o.status === "AWAITING_PAYMENT" ? "You won this and have not paid. Pay for it, or wait for the time to run out." : "You paid for this. Wait until it is delivered.",
      })),
      ...sales.map((o): DeletionBlocker => ({
        kind: "SALE_IN_PROGRESS",
        title: o.listing.title,
        listingId: o.listingId,
        orderId: o.id,
        text: o.status === "AWAITING_PAYMENT" ? "You sold this and the buyer has not paid yet." : o.shipmentStatus === "DELIVERED" ? "You sold this. Wait for your payout." : "You sold this. Ship it and wait for delivery and your payout.",
      })),
    ];
  }

  async status(userId: string): Promise<AccountDeletionStatus> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true } });
    if (!user) throw new NotFoundException();
    const closed = user.deletionRequestedAt;
    return {
      closedAt: closed?.toISOString() ?? null,
      deletesAt: closed ? new Date(closed.getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS).toISOString() : null,
      blockers: closed ? [] : await this.blockers(userId),
    };
  }

  // Asks for the code that confirms the deletion. Nothing is sent when something still stops the deletion.
  async sendCode(userId: string, input: StartAccountDeletionInput) {
    const user = await this.requirePassword(userId, input.password);
    await this.refuseIfBlocked(userId);
    const previous = await this.prisma.accountDeletionCode.findUnique({ where: { userId }, select: { createdAt: true } });
    const wait = loginCodeCooldownSeconds();
    const left = previous ? Math.ceil((previous.createdAt.getTime() + wait * 1000 - Date.now()) / 1000) : 0;
    if (wait > 0 && left > 0) {
      throw new HttpException({ code: "CODE_COOLDOWN", message: `A code was just sent. Wait ${left} second${left === 1 ? "" : "s"} before asking for another.`, retryAfterSeconds: left }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!(await this.limiter.allow(`rl:account-deletion:${userId}`, CODE_RATE_LIMIT.limit, CODE_RATE_LIMIT.windowSeconds))) {
      throw new HttpException({ code: "RATE_LIMITED", message: "You have asked for several codes. Wait a while and try again." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateCode();
    const data = { codeHash: hashCode(scope(userId), code), expiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0, createdAt: new Date() };
    await this.prisma.accountDeletionCode.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await this.mail.send(
      user.email,
      "Confirm deleting your account",
      `Your confirmation code is ${code}. It expires in 10 minutes.\n\nIf you did not ask to delete your account, ignore this email and change your password.`,
    );
  }

  // Closes the account. Auctions of theirs that have no bids (live or upcoming) are ended with no sale; drafts stay until the account is anonymised.
  async confirm(userId: string, input: ConfirmAccountDeletionInput): Promise<AccountDeletionStatus & { removedImageUrls: string[] }> {
    await this.requirePassword(userId, input.password);
    const invalid = () => new UnauthorizedException("Invalid or expired code");
    const record = await this.prisma.accountDeletionCode.findUnique({ where: { userId } });
    if (!record || record.expiresAt < new Date()) throw invalid();
    // The try is counted before the code is checked, in one guarded step, so simultaneous guesses cannot all slip under the limit.
    const { count: claimed } = await this.prisma.accountDeletionCode.updateMany({ where: { userId, attempts: { lt: MAX_CODE_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    if (claimed === 0 || !sameHash(hashCode(scope(userId), input.code), record.codeHash)) throw invalid();
    await this.refuseIfBlocked(userId);

    const closed = await this.prisma.user.updateMany({ where: { id: userId, deletionRequestedAt: null, deletedAt: null }, data: { deletionRequestedAt: new Date() } });
    if (closed.count === 0) throw new ConflictException({ code: "ALREADY_CLOSED", message: "This account is already scheduled for deletion." });
    await this.prisma.accountDeletionCode.deleteMany({ where: { userId } });
    await this.endUnbidAuctions(userId);
    return { ...(await this.status(userId)), removedImageUrls: await this.deleteDrafts(userId) };
  }

  async restore(userId: string): Promise<AccountDeletionStatus> {
    const restored = await this.prisma.user.updateMany({ where: { id: userId, deletionRequestedAt: { not: null }, deletedAt: null }, data: { deletionRequestedAt: null } });
    if (restored.count === 0) throw new ConflictException({ code: "NOT_CLOSED", message: "This account is not scheduled for deletion." });
    return this.status(userId);
  }

  // Drafts go at once (restoring does not bring them back). Their photos are in the image store, which the API cannot reach, so the
  // addresses that nothing else uses are handed back for the web app to delete, as when a draft is deleted by hand.
  private async deleteDrafts(sellerId: string): Promise<string[]> {
    const drafts = await this.prisma.listing.findMany({ where: { sellerId, status: "DRAFT" }, select: { id: true, images: { select: { url: true } } } });
    if (drafts.length === 0) return [];
    const urls = [...new Set(drafts.flatMap((d) => d.images.map((i) => i.url)))];
    await this.prisma.listing.deleteMany({ where: { id: { in: drafts.map((d) => d.id) } } });
    const stillUsed = new Set((await this.prisma.listingImage.findMany({ where: { url: { in: urls } }, select: { url: true } })).map((i) => i.url));
    return urls.filter((url) => !stillUsed.has(url));
  }

  private async endUnbidAuctions(sellerId: string) {
    const open = await this.prisma.listing.findMany({ where: { sellerId, status: "PUBLISHED", closedAt: null, endsAt: { gt: new Date() }, bidCount: 0 }, select: { id: true } });
    for (const { id } of open) {
      try {
        // `removedById` records who ended it: here the seller themselves.
        if (await this.closer.closeRemoved(id, { adminId: sellerId, reason: "The seller closed their account." })) await this.search.remove(id);
      } catch (error) {
        this.log.warn(`Could not end listing ${id} of closed account ${sellerId}: ${(error as Error).message}`);
      }
    }
  }

  // Anonymises every account whose grace period is over. Safe to run on every machine.
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let done = 0;
    try {
      const due = await this.prisma.user.findMany({ where: { deletedAt: null, deletionRequestedAt: { lte: new Date(Date.now() - ACCOUNT_DELETION_GRACE_DAYS * DAY_MS) } }, select: { id: true }, take: SWEEP_BATCH });
      for (const { id } of due) {
        try {
          if (await this.finalize(id)) done++;
        } catch (error) {
          this.log.error(`Could not delete account ${id}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.sweeping = false;
    }
    return done;
  }

  // Removes everything that identifies the person and keeps what other people's records depend on, which then shows as "Deleted user":
  // bids, orders, ratings, questions and answers, and the listings that are over. Returns false when it did nothing (not due, or
  // something other people depend on has appeared since: it is tried again later).
  async finalize(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true, deletedAt: true } });
    if (!user?.deletionRequestedAt || user.deletedAt || user.deletionRequestedAt.getTime() > Date.now() - ACCOUNT_DELETION_GRACE_DAYS * DAY_MS) return false;
    if ((await this.blockers(userId)).length > 0) return false;
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const fingerprint = emailFingerprint(owner.email);
    const anonymise = (username: string) =>
      this.prisma.$transaction(async (tx) => {
        await tx.watch.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.loginCode.deleteMany({ where: { userId } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.emailChange.deleteMany({ where: { userId } });
        await tx.accountDeletionCode.deleteMany({ where: { userId } });
        await tx.questionVote.deleteMany({ where: { userId } });
        await tx.pendingEndEmail.deleteMany({ where: { userId } });
        await tx.listing.deleteMany({ where: { sellerId: userId, status: "DRAFT" } });
        await tx.user.update({
          where: { id: userId },
          data: {
            email: `deleted-${userId}@deleted.invalid`,
            firstName: "Deleted",
            lastName: "user",
            username,
            passwordHash: "!deleted",
            emailVerified: null,
            pickupAddress: PrismaRuntime.DbNull,
            payoutAccountId: null,
            sessionVersion: { increment: 1 },
            emailFingerprint: fingerprint,
            deletedAt: new Date(),
          },
        });
      });
    try {
      await anonymise(`deleted_${userId.slice(-8)}`);
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      await anonymise(`deleted_${userId}`);
    }
    return true;
  }

  private async refuseIfBlocked(userId: string) {
    const blockers = await this.blockers(userId);
    if (blockers.length > 0) throw new ConflictException({ code: "DELETION_BLOCKED", message: "Some things have to finish before this account can be deleted.", blockers });
  }

  private async requirePassword(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new ForbiddenException("Incorrect password");
    return user;
  }
}

import { formatEur, minimumNextBidCents as minimumFor, SOCKET_EVENTS, type ExtendedNotice, type OutbidNotice } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Subscription } from "rxjs";
import { AuctionEvents } from "../bids/auction-events";
import type { BidResult } from "../bids/bids.service";
import { outbidEmailDelaySeconds, outbidEmailQuietSeconds, webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";
import { RealtimeGateway } from "./realtime.gateway";

const utc = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

const SWEEP_EVERY_MS = 30_000;

// Tells people what a bid meant for them: the bidder who was outbid gets a toast at once and, a little later, an email;
// every other bidder on an auction whose end time moved gets a toast. Nobody else is emailed. Runs after the bid is
// saved, so a failure here is logged and never touches the bid.
//
// The email waits (see outbidEmailDelaySeconds) so a bidding war collapses into one email, or none if the person bids
// again or is watching the page. An auction ending before the wait is over is emailed about at once. Waiting emails
// live in the database and a sweeper sends what is due, so a stopped API machine delays them but never loses them.
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NotificationsService.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: AuctionEvents,
    private readonly gateway: RealtimeGateway,
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  private timer?: ReturnType<typeof setInterval>;

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
    this.subscription = this.events.stream.subscribe((event) => {
      if (event.type !== "BidPlaced" || event.result.replayed) return;
      this.onBid(event.listingId, event.result).catch((error) => this.log.error(`Could not send notices: ${(error as Error).message}`));
    });
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    this.subscription?.unsubscribe();
  }

  private async onBid(listingId: string, result: BidResult) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, sellerId: true } });
    if (!listing) return;
    const { endsAt, extensionCount, currentBidCents, minimumNextBidCents } = result.listing;
    const newBidderId = result.listing.highBidderId;
    const outbidId = result.previousHighBidderId;

    if (outbidId && outbidId !== newBidderId) {
      const notice: OutbidNotice = {
        listingId,
        title: listing.title,
        currentBidCents,
        minimumNextBidCents,
        endsAt: endsAt.toISOString(),
        extended: result.extended,
        extensionCount,
      };
      this.gateway.emitToUsers([outbidId], SOCKET_EVENTS.outbid, notice);
      await this.queueOutbidEmail(outbidId, listingId, endsAt);
    }
    // Bidding again means they are here, so a waiting email for them is not needed.
    await this.prisma.pendingOutbidEmail.deleteMany({ where: { userId: newBidderId, listingId } });

    if (result.extended) {
      const bidders = await this.prisma.bid.findMany({ where: { listingId }, distinct: ["bidderId"], select: { bidderId: true } });
      const others = bidders.map((b) => b.bidderId).filter((id) => id !== newBidderId && id !== outbidId && id !== listing.sellerId);
      const notice: ExtendedNotice = {
        listingId,
        title: listing.title,
        endsAt: endsAt.toISOString(),
        extensionCount,
        final: result.listing.finalChance,
      };
      this.gateway.emitToUsers(others, SOCKET_EVENTS.extendedNotice, notice);
    }
  }

  // Due after the wait, or at once if the auction ends before the wait would be over (a late outbid has no time to spare).
  // An outbid while one is already waiting can bring the due time forward, never push it back.
  private async queueOutbidEmail(userId: string, listingId: string, endsAt: Date) {
    const now = Date.now();
    const delayMs = outbidEmailDelaySeconds() * 1000;
    const dueAt = new Date(endsAt.getTime() - now < delayMs ? now : now + delayMs);
    await this.prisma.$executeRaw`
      INSERT INTO "PendingOutbidEmail" ("id", "userId", "listingId", "dueAt")
      VALUES (${randomUUID()}, ${userId}, ${listingId}, ${dueAt})
      ON CONFLICT ("userId", "listingId") DO UPDATE
      SET "dueAt" = LEAST("PendingOutbidEmail"."dueAt", EXCLUDED."dueAt")`;
    if (dueAt.getTime() <= now) void this.sweep();
  }

  private sweeping = false;

  // Sends the outbid emails that are due. Safe to run on several machines at once: each row is claimed by deleting it.
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = await this.prisma.pendingOutbidEmail.findMany({ where: { dueAt: { lte: new Date() } }, orderBy: { dueAt: "asc" }, take: 100 });
      for (const pending of due) {
        const { count } = await this.prisma.pendingOutbidEmail.deleteMany({ where: { id: pending.id } });
        if (count === 0) continue;
        await this.sendOutbidEmail(pending).catch((error) => this.log.error(`Could not email an outbid notice: ${(error as Error).message}`));
      }
    } catch (error) {
      this.log.error(`Could not sweep outbid emails: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async sendOutbidEmail({ userId, listingId }: { userId: string; listingId: string }) {
    const [listing, user] = await Promise.all([
      this.prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true, status: true, endsAt: true, startingPriceCents: true, currentBidCents: true, highBidderId: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!listing || !user || listing.status !== "PUBLISHED" || !listing.endsAt) return;
    if (listing.highBidderId === userId) return; // back in front
    if (await this.gateway.isWatching(userId, listingId)) return; // sees it on the page
    if (!(await this.limiter.allow(`rl:outbid-email:${userId}:${listingId}`, 1, outbidEmailQuietSeconds()))) return;

    const current = listing.currentBidCents ?? listing.startingPriceCents;
    const ended = listing.endsAt.getTime() <= Date.now();
    const lines = ended
      ? [`The auction for "${listing.title}" has ended, and your bid was not the highest.`, "", `Final price: ${formatEur(current)}`]
      : [
          `You've been outbid on "${listing.title}".`,
          "",
          `Current bid: ${formatEur(current)}`,
          `Minimum next bid: ${formatEur(minimumFor(listing))}`,
          `Ends: ${utc(listing.endsAt)}`,
        ];
    lines.push("", `${webUrl()}/listings/${listingId}`);
    await this.mail.send(user.email, ended ? `${listing.title} has ended` : `You've been outbid on ${listing.title}`, lines.join("\n"));
  }
}

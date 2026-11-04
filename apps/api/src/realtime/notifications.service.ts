import { formatEur, minimumNextBidCents as minimumFor, SOCKET_EVENTS, type ExtendedNotice, type OutbidNotice, type UnreadEvent, type WonNotice } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Subscription } from "rxjs";
import { AuctionEvents } from "../bids/auction-events";
import type { BidResult } from "../bids/bids.service";
import { outbidEmailDelaySeconds, outbidEmailQuietSeconds, webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { utc } from "../email/format";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { SavedNotificationsService, type NewNotification } from "../notifications/saved-notifications.service";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";
import { RealtimeGateway } from "./realtime.gateway";

const SWEEP_EVERY_MS = 30_000;
// A send holds its row this long; if the machine stops mid-send the row comes due again afterwards.
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;

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
    private readonly saved: SavedNotificationsService,
  ) {}

  private timer?: ReturnType<typeof setInterval>;

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
    this.subscription = this.events.stream.subscribe((event) => {
      if (event.type === "AuctionClosed") {
        if (event.outcome === "SOLD" && event.winnerId && event.finalPriceCents != null) {
          this.tellWinner(event.listingId, event.winnerId, event.finalPriceCents).catch((error) => this.log.error(`Could not send the winner notice: ${(error as Error).message}`));
        }
        return;
      }
      if (event.type === "OrderExpired") {
        // The item is offered to the next bidder: they get the same live toast as a winner, worded as an offer.
        if (event.nextBuyerId && event.nextAmountCents != null) {
          this.tellWinner(event.listingId, event.nextBuyerId, event.nextAmountCents, true).catch((error) => this.log.error(`Could not send the offer notice: ${(error as Error).message}`));
        }
        return;
      }
      if (event.type !== "BidPlaced" || event.result.replayed) return;
      this.onBid(event.listingId, event.result).catch((error) => this.log.error(`Could not send notices: ${(error as Error).message}`));
    });
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    this.subscription?.unsubscribe();
  }

  // A live toast for the winner on any page they have open. Not saved and not replayed; the "you won" email covers it.
  private async tellWinner(listingId: string, winnerId: string, finalPriceCents: number, offered = false) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true } });
    if (!listing) return;
    this.gateway.emitToUsers([winnerId], SOCKET_EVENTS.wonNotice, { listingId, title: listing.title, finalPriceCents, ...(offered ? { offered } : {}) } satisfies WonNotice);
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
      await this.saveAndTellUnread([outbidId], { type: "OUTBID", key: `outbid:${listingId}`, listingId, title: listing.title, data: notice });
      this.gateway.emitToUsers([outbidId], SOCKET_EVENTS.outbid, notice);
      await this.queueOutbidEmail(outbidId, listingId, endsAt);
    }
    // Bidding again means they are here, so a waiting email for them is not needed.
    await this.prisma.pendingOutbidEmail.deleteMany({ where: { userId: newBidderId, listingId } });

    if (result.extended) {
      // A cap keeps a very long war from turning one bid into thousands of messages; the most recent bidders come first.
      const bidders = await this.prisma.$queryRaw<{ bidderId: string }[]>`
        SELECT "bidderId" FROM "Bid" WHERE "listingId" = ${listingId}
        GROUP BY "bidderId" ORDER BY MAX("createdAt") DESC LIMIT 500`;
      const others = bidders.map((b) => b.bidderId).filter((id) => id !== newBidderId && id !== outbidId && id !== listing.sellerId);
      const notice: ExtendedNotice = {
        listingId,
        title: listing.title,
        endsAt: endsAt.toISOString(),
        extensionCount,
        final: result.listing.finalChance,
      };
      await this.saveAndTellUnread(others, { type: "AUCTION_EXTENDED", key: `extended:${listingId}`, listingId, title: listing.title, data: notice });
      this.gateway.emitToUsers(others, SOCKET_EVENTS.extendedNotice, notice);
    }
  }

  // Saves the notification for each person and tells their open pages the new unread count. A failure here is logged
  // and the live toast still goes out.
  private async saveAndTellUnread(userIds: string[], notification: NewNotification) {
    try {
      const unread = await this.saved.save(userIds, notification);
      for (const [userId, unreadCount] of unread) this.gateway.emitToUsers([userId], SOCKET_EVENTS.unread, { unreadCount } satisfies UnreadEvent);
    } catch (error) {
      this.log.error(`Could not save a notification: ${(error as Error).message}`);
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

  // Sends the outbid emails that are due. Safe to run on several machines at once: a row is claimed by moving its due
  // time out (a lease), and it is deleted only after the email has gone. A failed or interrupted send leaves it to come
  // due again, up to MAX_ATTEMPTS times.
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = await this.prisma.pendingOutbidEmail.findMany({ where: { dueAt: { lte: new Date() } }, orderBy: { dueAt: "asc" }, take: 100 });
      for (const candidate of due) {
        const claimed = await this.prisma.$queryRaw<{ id: string; userId: string; listingId: string; attempts: number }[]>`
          UPDATE "PendingOutbidEmail" SET "dueAt" = ${new Date(Date.now() + LEASE_MS)}, "attempts" = "attempts" + 1
          WHERE "id" = ${candidate.id} AND "dueAt" <= ${new Date()}
          RETURNING "id", "userId", "listingId", "attempts"`;
        const pending = claimed[0];
        if (!pending) continue; // another machine got it
        if (pending.attempts > MAX_ATTEMPTS) {
          this.log.error(`Giving up on an outbid email for ${pending.userId} on ${pending.listingId} after ${MAX_ATTEMPTS} tries`);
          await this.prisma.pendingOutbidEmail.deleteMany({ where: { id: pending.id } });
          continue;
        }
        try {
          await this.sendOutbidEmail(pending);
          await this.prisma.pendingOutbidEmail.deleteMany({ where: { id: pending.id } });
        } catch (error) {
          this.log.error(`Could not email an outbid notice (try ${pending.attempts} of ${MAX_ATTEMPTS}): ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.log.error(`Could not sweep outbid emails: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  // Returns normally when the email was sent or was not needed; throws when it should be tried again.
  private async sendOutbidEmail({ userId, listingId, attempts }: { userId: string; listingId: string; attempts: number }) {
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
    // Once the auction has ended, the close sends everyone who did not win an "auction ended" email with the final price
    // (AuctionEndEmailService), so this one would be a second email about the same thing.
    if (listing.endsAt.getTime() <= Date.now()) return;
    // A retry takes the slot again but is not stopped by it: an earlier try may have taken the slot and never sent.
    const quietKey = `rl:outbid-email:${userId}:${listingId}`;
    const allowed = await this.limiter.allow(quietKey, 1, outbidEmailQuietSeconds());
    if (!allowed && attempts === 1) return;

    const current = listing.currentBidCents ?? listing.startingPriceCents;
    const lines = [
      `You've been outbid on "${listing.title}".`,
      "",
      `Current bid: ${formatEur(current)}`,
      `Minimum next bid: ${formatEur(minimumFor(listing))}`,
      `Ends: ${utc(listing.endsAt)}`,
    ];
    lines.push("", `${webUrl()}/listings/${listingId}`);
    try {
      await this.mail.send(user.email, `You've been outbid on ${listing.title}`, lines.join("\n"));
    } catch (error) {
      await this.limiter.reset(quietKey); // nothing was sent, so do not hold back the next one
      throw error;
    }
  }
}

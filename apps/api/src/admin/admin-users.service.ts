import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { listingPhase, PAYMENT_WINDOW_HOURS, SUSPENDED_ORDER_DAYS } from "@auction/shared";
import { AdminListingsService } from "./admin-listings.service";
import { queueMail } from "../email/mail-outbox";
import { giveAdminStrike } from "./admin-strikes";
import { supportEmail } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { emailUnbanNotice } from "./unban-notice";
import { RealtimeGateway } from "../realtime/realtime.gateway";

export interface UserListQuery {
  q?: string;
  banned?: boolean;
  limit: number;
}

const summary = {
  id: true, username: true, email: true, firstName: true, lastName: true, role: true, isSuperAdmin: true, createdAt: true, emailVerified: true, bannedAt: true, banReason: true,
  _count: { select: { strikes: true, listings: true, bids: { where: { kind: { not: "RAISE" } } } } },
} as const;

// What the admin app does to accounts: find them, suspend and restore them, and clear a strike. A ban takes effect on the
// person's next request (the API reads it from the database every time, see JwtAuthGuard) and, here, at once for any page
// they have open: their sockets are told and hung up. A ban does not touch their listings, bids or orders, and does not hold
// back a payout (decided 2026-11-05); an admin removes a listing separately.
@Injectable()
export class AdminUsersService {
  private readonly log = new Logger(AdminUsersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly gateway: RealtimeGateway,
    private readonly listings: AdminListingsService,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  async list({ q, banned, limit }: UserListQuery) {
    const term = q?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        ...(banned ? { bannedAt: { not: null } } : {}),
        ...(term ? { OR: [{ username: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { id: term }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: summary,
    });
    return { users: users.map(toSummary) };
  }

  // The auctions a person has bid on, the latest bid first, one row per auction: their own highest bid, how many bids they placed
  // there, and where it stands (leading, won, outbid, lost). `total` is how many auctions, whatever the limit.
  async bids(id: string, limit: number) {
    if (!(await this.prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException();
    const now = new Date();
    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string; title: string; startsAt: Date | null; endsAt: Date | null; currentBidCents: number | null; highBidderId: string | null; winnerId: string | null;
          outcome: "SOLD" | "NO_SALE" | "NO_BIDS" | null; removedAt: Date | null; highestCents: number; bids: number; lastBidAt: Date;
        }[]
      >`
        SELECT l."id", l."title", l."startsAt", l."endsAt", l."currentBidCents", l."highBidderId", l."winnerId", l."outcome", l."removedAt",
               MAX(b."amountCents")::int AS "highestCents", COUNT(*)::int AS "bids", MAX(b."createdAt") AS "lastBidAt"
        FROM "Bid" b JOIN "Listing" l ON l."id" = b."listingId"
        WHERE b."bidderId" = ${id} AND b."kind" <> 'RAISE'
        GROUP BY l."id"
        ORDER BY MAX(b."createdAt") DESC, l."id" ASC
        LIMIT ${limit}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(DISTINCT "listingId")::int AS "total" FROM "Bid" WHERE "bidderId" = ${id}`,
    ]);
    return {
      total,
      auctions: rows.map((r) => {
        const phase = listingPhase({ status: "PUBLISHED", startsAt: r.startsAt, endsAt: r.endsAt }, now);
        const state = r.removedAt ? "removed" : phase !== "ended" ? (r.highBidderId === id ? "leading" : "outbid") : r.winnerId === id ? "won" : "lost";
        return {
          id: r.id,
          title: r.title,
          phase,
          state,
          outcome: r.outcome,
          yourHighestCents: r.highestCents,
          yourBids: r.bids,
          priceCents: r.currentBidCents,
          endsAt: r.endsAt?.toISOString() ?? null,
          lastBidAt: r.lastBidAt.toISOString(),
        };
      }),
    };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: summary });
    if (!user) throw new NotFoundException();
    const strikes = await this.prisma.strike.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" } });
    const listings = await this.prisma.listing.findMany({ where: { id: { in: strikes.flatMap((s) => (s.listingId ? [s.listingId] : [])) } }, select: { id: true, title: true } });
    const titleOf = new Map(listings.map((l) => [l.id, l.title]));
    return {
      ...toSummary(user),
      strikes: strikes.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        orderId: s.givenById ? null : s.orderId,
        reason: s.reason,
        givenByAdmin: s.givenById !== null,
        listing: s.listingId && titleOf.has(s.listingId) ? { id: s.listingId, title: titleOf.get(s.listingId)! } : null,
      })),
    };
  }

  // An admin cannot be banned (demote them first), so one admin can never lock the others out. One guarded update makes two
  // admins banning the same person at once ban once; the loser gets ALREADY_BANNED.
  async ban(adminId: string, id: string, reason: string) {
    const done = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id, bannedAt: null, role: { not: "ADMIN" } }, data: { bannedAt: new Date(), banReason: reason } });
      if (updated.count > 0) {
        await tx.adminAction.create({ data: { adminId, action: "BAN_USER", targetId: id, reason } });
        // Buyers who were asked to pay this seller are told their order is paused, in the same transaction as the ban.
        const waiting = await tx.order.findMany({ where: { sellerId: id, status: "AWAITING_PAYMENT" }, select: { buyerId: true, listingId: true } });
        for (const { buyerId, listingId } of waiting) await queueMail(tx, { userId: buyerId, listingId, kind: "SELLER_SUSPENDED" });
      }
      return updated;
    });
    if (done.count === 0) {
      const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true, bannedAt: true } });
      if (!user) throw new NotFoundException();
      if (user.role === "ADMIN") throw new ConflictException({ code: "CANNOT_BAN_ADMIN", message: "An admin cannot be banned. Remove their admin role first." });
      throw new ConflictException({ code: "ALREADY_BANNED", message: "This account is already banned." });
    }
    try {
      this.gateway.suspendUser(id);
    } catch (error) {
      // The ban is saved and every request is refused already; only the live hang-up failed.
      this.log.error(`Could not disconnect banned user ${id}: ${(error as Error).message}`);
    }
    await this.endAuctions(adminId, id);
    // Not awaited: a slow mail provider must not hold the admin's request; emailBan never throws.
    void this.emailBan(id, reason);
    return this.get(id);
  }

  // Banning a seller ends every live and upcoming auction of theirs, with no sale, the way an admin removes a listing (bidders
  // are told, the listing leaves search). Their orders are not touched: while the seller is banned an order that waits for
  // payment or for its payout is paused (see `isSellerSuspended`), and unbanning releases it. A listing that cannot be ended now (it
  // has just run out and is closing) is left to its normal close.
  private async endAuctions(adminId: string, sellerId: string) {
    const open = await this.prisma.listing.findMany({ where: { sellerId, status: "PUBLISHED", closedAt: null, endsAt: { gt: new Date() } }, select: { id: true } });
    for (const { id } of open) {
      try {
        await this.listings.remove(adminId, id, "The seller's account was suspended.");
      } catch (error) {
        this.log.warn(`Could not end listing ${id} of banned seller ${sellerId}: ${(error as Error).message}`);
      }
    }
  }

  // Tells the person why. Best effort and sent straight away: the ban stands whether or not the email goes.
  private async emailBan(id: string, reason: string) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id }, select: { email: true } });
      if (!user) return;
      await this.mail.send(user.email, "Your account has been suspended", [
        "A moderator has suspended your account, so you can no longer sign in, bid or sell.",
        "",
        `Reason: ${reason}`,
        "",
        `Your live and scheduled auctions have been ended with no sale. Orders from your sales that are waiting for payment or for their payout are paused, not cancelled: they go ahead if the suspension is lifted. An order still waiting for payment after ${SUSPENDED_ORDER_DAYS} days is cancelled.`,
        "",
        `If you think this is a mistake, ${supportEmail() ? `write to ${supportEmail()}` : "reply to this email"}.`,
      ].join("\n"));
    } catch (error) {
      this.log.error(`Could not email the ban notice to ${id}: ${(error as Error).message}`);
    }
  }

  // The admin's reason for lifting the ban is kept in the audit log, next to who did it.
  async unban(adminId: string, id: string, reason: string) {
    const done = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id, bannedAt: { not: null } }, data: { bannedAt: null, banReason: null } });
      if (updated.count > 0) {
        await tx.adminAction.create({ data: { adminId, action: "UNBAN_USER", targetId: id, reason } });
        // Orders that waited for payment during the ban were paused: their buyers get the full window again (and the reminder
        // again), never less than they had left.
        await tx.$executeRaw`
          UPDATE "Order" SET "payBy" = GREATEST("payBy", clock_timestamp() + ${PAYMENT_WINDOW_HOURS} * interval '1 hour'),
            "payReminderSentAt" = NULL, "payReminderClaimedAt" = NULL, "updatedAt" = clock_timestamp()
          WHERE "sellerId" = ${id} AND "status" = 'AWAITING_PAYMENT'`;
      }
      return updated;
    });
    if (done.count === 0) {
      if (!(await this.prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException();
      throw new ConflictException({ code: "NOT_BANNED", message: "This account is not banned." });
    }
    void emailUnbanNotice(this.prisma, this.mail, this.log, id);
    return this.get(id);
  }

  // Makes an account an admin or an ordinary user again. An admin cannot change their own role (so nobody locks themselves out
  // by accident) and the last admin cannot be demoted. The admin rows are locked while the count is read, so two admins
  // demoting each other at the same moment cannot leave the site with none. A demoted admin loses access on their next request
  // (the guard reads the role from the database every time). A banned account cannot be made an admin.
  // Only a super admin changes roles, and a super admin's own role is left alone (it is changed from the command line).
  async setRole(adminId: string, actorIsSuperAdmin: boolean, id: string, role: "USER" | "ADMIN") {
    if (!actorIsSuperAdmin) throw new ForbiddenException({ code: "SUPERADMIN_ONLY", message: "Only a super admin can change admin roles." });
    if (id === adminId) throw new ConflictException({ code: "CANNOT_CHANGE_OWN_ROLE", message: "You cannot change your own role. Ask another admin." });
    await this.prisma.$transaction(async (tx) => {
      const admins = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "role" = 'ADMIN' FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id }, select: { role: true, isSuperAdmin: true, bannedAt: true } });
      if (!user) throw new NotFoundException();
      if (user.isSuperAdmin) throw new ConflictException({ code: "CANNOT_CHANGE_SUPERADMIN", message: "A super admin's role can only be changed from the command line." });
      if (user.role === role) throw new ConflictException({ code: "SAME_ROLE", message: role === "ADMIN" ? "This account is already an admin." : "This account is not an admin." });
      if (role === "ADMIN" && user.bannedAt) throw new ConflictException({ code: "BANNED", message: "A banned account cannot be made an admin. Restore it first." });
      if (role === "USER" && admins.length <= 1) throw new ConflictException({ code: "LAST_ADMIN", message: "This is the last admin, so the role cannot be removed." });
      await tx.user.update({ where: { id }, data: { role } });
      await tx.adminAction.create({ data: { adminId, action: "SET_ROLE", targetId: id, reason: role } });
    });
    return this.get(id);
  }

  // A strike for conduct (a reason is required). Two strikes block bidding, as for an unpaid order.
  async strike(adminId: string, id: string, reason: string) {
    await this.prisma.$transaction((tx) => giveAdminStrike(tx, adminId, id, reason));
    return this.get(id);
  }

  // Two strikes block bidding; clearing one brings the person under the limit again. Orders and listings are untouched.
  async clearStrike(adminId: string, strikeId: string) {
    const strike = await this.prisma.strike.findUnique({ where: { id: strikeId }, select: { userId: true } });
    if (!strike) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.strike.deleteMany({ where: { id: strikeId } });
      if (deleted.count > 0) await tx.adminAction.create({ data: { adminId, action: "CLEAR_STRIKE", targetId: strike.userId, reason: strikeId } });
    });
    return this.get(strike.userId);
  }
}

const toSummary = (u: {
  id: string; username: string; email: string; firstName: string; lastName: string; role: string; isSuperAdmin: boolean; createdAt: Date; emailVerified: Date | null; bannedAt: Date | null; banReason: string | null;
  _count: { strikes: number; listings: number; bids: number };
}) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  name: `${u.firstName} ${u.lastName}`,
  role: u.role,
  isSuperAdmin: u.isSuperAdmin,
  createdAt: u.createdAt.toISOString(),
  emailVerified: u.emailVerified !== null,
  bannedAt: u.bannedAt?.toISOString() ?? null,
  banReason: u.banReason,
  strikeCount: u._count.strikes,
  listingCount: u._count.listings,
  bidCount: u._count.bids,
});

import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
  _count: { select: { strikes: true, listings: true, bids: true } },
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
      if (updated.count > 0) await tx.adminAction.create({ data: { adminId, action: "BAN_USER", targetId: id, reason } });
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
    // Not awaited: a slow mail provider must not hold the admin's request; emailBan never throws.
    void this.emailBan(id, reason);
    return this.get(id);
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
        `Your existing listings, bids and orders are not changed. If you think this is a mistake, ${supportEmail() ? `write to ${supportEmail()}` : "reply to this email"}.`,
      ].join("\n"));
    } catch (error) {
      this.log.error(`Could not email the ban notice to ${id}: ${(error as Error).message}`);
    }
  }

  async unban(adminId: string, id: string) {
    const done = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id, bannedAt: { not: null } }, data: { bannedAt: null, banReason: null } });
      if (updated.count > 0) await tx.adminAction.create({ data: { adminId, action: "UNBAN_USER", targetId: id } });
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

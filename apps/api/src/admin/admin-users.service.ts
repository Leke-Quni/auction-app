import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { RealtimeGateway } from "../realtime/realtime.gateway";

export interface UserListQuery {
  q?: string;
  banned?: boolean;
  limit: number;
}

const summary = {
  id: true, username: true, email: true, firstName: true, lastName: true, role: true, createdAt: true, emailVerified: true, bannedAt: true, banReason: true,
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
    const listings = await this.prisma.listing.findMany({ where: { id: { in: strikes.map((s) => s.listingId) } }, select: { id: true, title: true } });
    const titleOf = new Map(listings.map((l) => [l.id, l.title]));
    return {
      ...toSummary(user),
      strikes: strikes.map((s) => ({ id: s.id, createdAt: s.createdAt.toISOString(), orderId: s.orderId, listing: titleOf.has(s.listingId) ? { id: s.listingId, title: titleOf.get(s.listingId)! } : null })),
    };
  }

  // An admin cannot be banned (demote them first), so one admin can never lock the others out. One guarded update makes two
  // admins banning the same person at once ban once; the loser gets ALREADY_BANNED.
  async ban(id: string, reason: string) {
    const done = await this.prisma.user.updateMany({ where: { id, bannedAt: null, role: { not: "ADMIN" } }, data: { bannedAt: new Date(), banReason: reason } });
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
    return this.get(id);
  }

  async unban(id: string) {
    const done = await this.prisma.user.updateMany({ where: { id, bannedAt: { not: null } }, data: { bannedAt: null, banReason: null } });
    if (done.count === 0) {
      if (!(await this.prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException();
      throw new ConflictException({ code: "NOT_BANNED", message: "This account is not banned." });
    }
    return this.get(id);
  }

  // Two strikes block bidding; clearing one brings the person under the limit again. Orders and listings are untouched.
  async clearStrike(strikeId: string) {
    const strike = await this.prisma.strike.findUnique({ where: { id: strikeId }, select: { userId: true } });
    if (!strike) throw new NotFoundException();
    await this.prisma.strike.deleteMany({ where: { id: strikeId } });
    return this.get(strike.userId);
  }
}

const toSummary = (u: {
  id: string; username: string; email: string; firstName: string; lastName: string; role: string; createdAt: Date; emailVerified: Date | null; bannedAt: Date | null; banReason: string | null;
  _count: { strikes: number; listings: number; bids: number };
}) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  name: `${u.firstName} ${u.lastName}`,
  role: u.role,
  createdAt: u.createdAt.toISOString(),
  emailVerified: u.emailVerified !== null,
  bannedAt: u.bannedAt?.toISOString() ?? null,
  banReason: u.banReason,
  strikeCount: u._count.strikes,
  listingCount: u._count.listings,
  bidCount: u._count.bids,
});

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { supportEmail } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { emailUnbanNotice } from "./unban-notice";

export interface SupportListQuery {
  status: "OPEN" | "HANDLED";
  limit: number;
}

// What people sent through the support form. Open ones oldest first; handled ones newest first.
@Injectable()
export class AdminSupportService {
  private readonly log = new Logger(AdminSupportService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  async list({ status, limit }: SupportListQuery) {
    const [rows, openCount] = await Promise.all([
      this.prisma.supportRequest.findMany({
        where: { status },
        orderBy: [{ createdAt: status === "OPEN" ? "asc" : "desc" }, { id: "asc" }],
        take: limit,
        include: { user: { select: { id: true, username: true, email: true, bannedAt: true, banReason: true, _count: { select: { strikes: true } } } } },
      }),
      this.prisma.supportRequest.count({ where: { status: "OPEN" } }),
    ]);
    const strikeIds = rows.flatMap((r) => (r.strikeId ? [r.strikeId] : []));
    const strikes = await this.prisma.strike.findMany({ where: { id: { in: strikeIds } } });
    const listings = await this.prisma.listing.findMany({ where: { id: { in: strikes.flatMap((s) => (s.listingId ? [s.listingId] : [])) } }, select: { id: true, title: true } });
    const titleOf = new Map(listings.map((l) => [l.id, l.title]));
    const strikeOf = new Map(strikes.map((s) => [s.id, s]));
    return {
      openCount,
      requests: rows.map((r) => {
        const strike = r.strikeId ? strikeOf.get(r.strikeId) : undefined;
        return {
          id: r.id,
          kind: r.kind,
          status: r.status,
          message: r.message,
          createdAt: r.createdAt.toISOString(),
          handledAt: r.handledAt?.toISOString() ?? null,
          user: { id: r.user.id, username: r.user.username, email: r.user.email, strikeCount: r.user._count.strikes, banned: r.user.bannedAt !== null, banReason: r.user.banReason },
          // For an appeal: the strike, or null once it has been cleared (the appeal outlives it).
          strike: r.kind === "STRIKE_APPEAL" ? (strike ? { id: strike.id, createdAt: strike.createdAt.toISOString(), reason: strike.reason, givenByAdmin: strike.givenById !== null, listingTitle: strike.listingId ? (titleOf.get(strike.listingId) ?? null) : null } : null) : null,
        };
      }),
    };
  }

  // Closing one that is already closed changes nothing, so a double click is harmless.
  async handle(adminId: string, id: string) {
    let refusedAppealUserId: string | null = null;
    const done = await this.prisma.$transaction(async (tx) => {
      const request = await tx.supportRequest.findUnique({ where: { id }, select: { kind: true, strikeId: true, userId: true } });
      const updated = await tx.supportRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date(), handledById: adminId } });
      if (updated.count > 0) await tx.adminAction.create({ data: { adminId, action: "HANDLE_SUPPORT", targetId: id } });
      // Closing an appeal whose strike still stands is a refusal; one whose strike is already gone has nothing to refuse.
      if (updated.count > 0 && request?.kind === "STRIKE_APPEAL" && request.strikeId && (await tx.strike.count({ where: { id: request.strikeId } })) > 0) refusedAppealUserId = request.userId;
      return updated.count;
    });
    // Not awaited: a slow mail provider must not hold up the admin's request; emailAppealResult never throws.
    if (refusedAppealUserId) void this.emailAppealResult(refusedAppealUserId, false);
    const row = await this.prisma.supportRequest.findUnique({ where: { id }, select: { id: true, status: true, handledAt: true } });
    if (!row) throw new NotFoundException();
    return { id: row.id, status: row.status, handledAt: row.handledAt?.toISOString() ?? null, changed: done > 0 };
  }

  // Grants a strike appeal: closes the request and clears its strike in one transaction, so a failure between the two cannot leave
  // the strike gone and the appeal open. The close is a guarded update and comes first, so an appeal another admin already closed
  // (granted or refused) clears nothing. If the strike was already cleared, the request is just closed.
  async grantAppeal(adminId: string, id: string) {
    let userId = "";
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.supportRequest.findUnique({ where: { id }, select: { kind: true, strikeId: true, userId: true } });
      if (!request) throw new NotFoundException();
      userId = request.userId;
      if (request.kind !== "STRIKE_APPEAL" || !request.strikeId) throw new ConflictException({ code: "NOT_AN_APPEAL", message: "This request is not a strike appeal." });
      const closed = await tx.supportRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date(), handledById: adminId } });
      if (closed.count === 0) return { id, changed: false, strikeCleared: false };
      await tx.adminAction.create({ data: { adminId, action: "HANDLE_SUPPORT", targetId: id, reason: "appeal granted" } });
      const cleared = await tx.strike.deleteMany({ where: { id: request.strikeId, userId: request.userId } });
      if (cleared.count > 0) await tx.adminAction.create({ data: { adminId, action: "CLEAR_STRIKE", targetId: request.userId, reason: request.strikeId } });
      return { id, changed: true, strikeCleared: cleared.count > 0 };
    });
    if (result.strikeCleared) void this.emailAppealResult(userId, true);
    return result;
  }

  // Grants a ban appeal: closes the request and lifts the ban in one transaction. The close is a guarded update and comes first, so a
  // request another admin already closed lifts nothing. If the ban was lifted already, the request is just closed.
  async liftBan(adminId: string, id: string) {
    let userId = "";
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.supportRequest.findUnique({ where: { id }, select: { kind: true, userId: true } });
      if (!request) throw new NotFoundException();
      userId = request.userId;
      if (request.kind !== "BAN_APPEAL") throw new ConflictException({ code: "NOT_A_BAN_APPEAL", message: "This request is not a ban appeal." });
      const closed = await tx.supportRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date(), handledById: adminId } });
      if (closed.count === 0) return { id, changed: false, banLifted: false };
      await tx.adminAction.create({ data: { adminId, action: "HANDLE_SUPPORT", targetId: id, reason: "ban appeal granted" } });
      const lifted = await tx.user.updateMany({ where: { id: request.userId, bannedAt: { not: null } }, data: { bannedAt: null, banReason: null } });
      if (lifted.count > 0) await tx.adminAction.create({ data: { adminId, action: "UNBAN_USER", targetId: request.userId } });
      return { id, changed: true, banLifted: lifted.count > 0 };
    });
    if (result.banLifted) void emailUnbanNotice(this.prisma, this.mail, this.log, userId);
    return result;
  }

  // Tells the person how their appeal went. Best effort: the decision stands whether or not the email goes.
  private async emailAppealResult(userId: string, granted: boolean) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) return;
      const help = supportEmail() ? `write to ${supportEmail()}` : "reply to this email";
      await this.mail.send(
        user.email,
        granted ? "Your strike appeal was accepted" : "Your strike appeal was denied",
        (granted
          ? ["A moderator reviewed your appeal and accepted it. The strike has been removed from your account."]
          : ["A moderator reviewed your appeal and denied it. The strike stays on your account.", "", `If you have more to add, ${help}.`]
        ).join("\n"),
      );
    } catch (error) {
      this.log.error(`Could not email the appeal result to ${userId}: ${(error as Error).message}`);
    }
  }
}

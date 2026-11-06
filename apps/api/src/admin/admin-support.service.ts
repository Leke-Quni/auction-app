import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";

export interface SupportListQuery {
  status: "OPEN" | "HANDLED";
  limit: number;
}

// What people sent through the support form. Open ones oldest first; handled ones newest first.
@Injectable()
export class AdminSupportService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async list({ status, limit }: SupportListQuery) {
    const [rows, openCount] = await Promise.all([
      this.prisma.supportRequest.findMany({
        where: { status },
        orderBy: [{ createdAt: status === "OPEN" ? "asc" : "desc" }, { id: "asc" }],
        take: limit,
        include: { user: { select: { id: true, username: true, email: true, _count: { select: { strikes: true } } } } },
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
          user: { id: r.user.id, username: r.user.username, email: r.user.email, strikeCount: r.user._count.strikes },
          // For an appeal: the strike, or null once it has been cleared (the appeal outlives it).
          strike: r.kind === "STRIKE_APPEAL" ? (strike ? { id: strike.id, createdAt: strike.createdAt.toISOString(), reason: strike.reason, givenByAdmin: strike.givenById !== null, listingTitle: strike.listingId ? (titleOf.get(strike.listingId) ?? null) : null } : null) : null,
        };
      }),
    };
  }

  // Closing one that is already closed changes nothing, so a double click is harmless.
  async handle(adminId: string, id: string) {
    const done = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "HANDLED", handledAt: new Date(), handledById: adminId } });
      if (updated.count > 0) await tx.adminAction.create({ data: { adminId, action: "HANDLE_SUPPORT", targetId: id } });
      return updated.count;
    });
    const row = await this.prisma.supportRequest.findUnique({ where: { id }, select: { id: true, status: true, handledAt: true } });
    if (!row) throw new NotFoundException();
    return { id: row.id, status: row.status, handledAt: row.handledAt?.toISOString() ?? null, changed: done > 0 };
  }
}

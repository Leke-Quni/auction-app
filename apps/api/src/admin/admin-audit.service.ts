import { Inject, Injectable } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";

export interface AuditQuery {
  adminId?: string;
  targetId?: string;
  limit: number;
}

// The record of what admins did (ban, restore, clear a strike, remove a listing, open an order). Rows have no foreign keys, so
// the admin and the target are looked up here and shown as null when gone. Kept for ever.
@Injectable()
export class AdminAuditService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async list({ adminId, targetId, limit }: AuditQuery) {
    const rows = await this.prisma.adminAction.findMany({
      where: { ...(adminId ? { adminId } : {}), ...(targetId ? { targetId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });
    const admins = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.adminId))] } }, select: { id: true, username: true } });
    const nameOf = new Map(admins.map((a) => [a.id, a.username]));
    return {
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        targetId: r.targetId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        admin: { id: r.adminId, username: nameOf.get(r.adminId) ?? null },
      })),
    };
  }
}

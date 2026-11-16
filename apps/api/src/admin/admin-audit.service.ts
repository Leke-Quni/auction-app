import { Inject, Injectable } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";

export interface AuditQuery {
  adminId?: string;
  targetId?: string;
  q?: string;
  // Sort by one column (newest first without one) and narrow by the text typed under a column header; `f_admin` matches the admin like `q`.
  sort?: "when" | "target" | "reason";
  dir?: "asc" | "desc";
  f_admin?: string;
  f_action?: "BAN_USER" | "UNBAN_USER" | "CLEAR_STRIKE" | "REMOVE_LISTING" | "VIEW_ORDER" | "REMOVE_POST" | "SET_ROLE" | "STRIKE_USER" | "VIEW_INVOICE" | "HANDLE_SUPPORT" | "ADD_ORDER_NOTE" | "RESEND_ORDER_EMAIL";
  f_target?: string;
  f_reason?: string;
  page: number;
  limit: number;
}

const auditOrder = (sort: AuditQuery["sort"], d: "asc" | "desc") =>
  sort === "when" ? { createdAt: d } : sort === "target" ? { targetId: d } : sort === "reason" ? { reason: d } : { createdAt: "desc" as const };

// The record of what admins did (ban, restore, clear a strike, remove a listing, open an order). Rows have no foreign keys, so
// the admin and the target are looked up here and shown as null when gone. Kept for ever.
@Injectable()
export class AdminAuditService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  // `q` finds entries by the admin who acted: part of their username or email, or their id (which still works once the account is gone).
  // Any account is searched, not only current admins, since a demoted admin's actions are kept and still listed.
  // `total` is how many entries match, whatever the page.
  async list({ adminId, targetId, q, sort, dir = "asc", f_admin, f_action, f_target, f_reason, page, limit }: AuditQuery) {
    const term = (f_admin?.trim() || q?.trim()) || undefined;
    const adminIds = term
      ? [term, ...(await this.prisma.user.findMany({ where: { OR: [{ username: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { id: term }] }, select: { id: true }, take: 50 })).map((u) => u.id)]
      : null;
    const where = { ...(adminId ? { adminId } : {}), ...(targetId ? { targetId } : {}), AND: [...(f_action ? [{ action: f_action }] : []), ...(f_target ? [{ targetId: { contains: f_target, mode: "insensitive" as const } }] : []), ...(f_reason ? [{ reason: { contains: f_reason, mode: "insensitive" as const } }] : [])], ...(adminIds ? { adminId: adminId ? { in: adminIds.filter((id) => id === adminId) } : { in: adminIds } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.adminAction.findMany({ where, orderBy: [auditOrder(sort, dir), { id: "asc" }], skip: (page - 1) * limit, take: limit }),
      this.prisma.adminAction.count({ where }),
    ]);
    const admins = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.adminId))] } }, select: { id: true, username: true } });
    const nameOf = new Map(admins.map((a) => [a.id, a.username]));
    return {
      total,
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

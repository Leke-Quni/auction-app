import { ORDER_ATTENTION, ORDER_ATTENTION_KINDS, type OrderAttentionKind } from "@auction/shared";
import type { Prisma as PrismaTypes } from "@auction/db";
import { payoutDelayDays } from "../config";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// The database condition for each kind, and `attentionOf` below says the same thing for one loaded order. They are written side by
// side so a change to one is made to the other; a test checks they agree.
export function attentionWhere(kind: OrderAttentionKind | "any", now: Date): PrismaTypes.OrderWhereInput {
  if (kind === "any") return { OR: ORDER_ATTENTION_KINDS.map((k) => attentionWhere(k, now)) };
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  switch (kind) {
    case "expiring":
      return { status: "AWAITING_PAYMENT", payBy: { gt: now, lte: new Date(now.getTime() + ORDER_ATTENTION.expiringHours * HOUR) } };
    case "overdue":
      return { status: "AWAITING_PAYMENT", payBy: { lte: now } };
    case "not-shipped":
      return { status: "PAID", shipmentStatus: null, paidAt: { lte: ago(ORDER_ATTENTION.notShippedDays) } };
    case "not-delivered":
      return { status: "PAID", shipmentStatus: { in: ["LABEL_CREATED", "IN_TRANSIT"] }, shippedAt: { lte: ago(ORDER_ATTENTION.notDeliveredDays) } };
    case "payout-late":
      return { status: "PAID", shipmentStatus: "DELIVERED", payout: { is: null }, deliveredAt: { lte: ago(payoutDelayDays() + ORDER_ATTENTION.payoutGraceDays) } };
  }
}

interface AttentionOrder {
  status: string;
  payBy: Date;
  paidAt: Date | null;
  shipmentStatus: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  payout: unknown;
}

// Why an order needs a look, or null. An order matches at most one kind except when two of the conditions overlap; the first listed wins.
export function attentionOf(o: AttentionOrder, now: Date): OrderAttentionKind | null {
  const age = (date: Date | null) => (date ? now.getTime() - date.getTime() : -Infinity);
  if (o.status === "AWAITING_PAYMENT") {
    if (o.payBy <= now) return "overdue";
    return o.payBy.getTime() - now.getTime() <= ORDER_ATTENTION.expiringHours * HOUR ? "expiring" : null;
  }
  if (o.status !== "PAID") return null;
  if (o.shipmentStatus === null) return age(o.paidAt) >= ORDER_ATTENTION.notShippedDays * DAY ? "not-shipped" : null;
  if (o.shipmentStatus === "DELIVERED") {
    return !o.payout && age(o.deliveredAt) >= (payoutDelayDays() + ORDER_ATTENTION.payoutGraceDays) * DAY ? "payout-late" : null;
  }
  return age(o.shippedAt) >= ORDER_ATTENTION.notDeliveredDays * DAY ? "not-delivered" : null;
}

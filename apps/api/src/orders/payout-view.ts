import type { OrderPayout } from "@auction/shared";
import { payoutDelayDays } from "../config";

// Where a paid order's payout to the seller stands. Shared by the seller's own order page and the admin app, so both say
// the same thing: due 3 days after delivery (`PAYOUT_DELAY_DAYS`), and waiting on the seller while they have no payment account.
export function payoutViewOf(order: { deliveredAt: Date | null; sellerNetCents: number; payout: { paidAt: Date } | null; seller: { payoutAccountId: string | null } }): OrderPayout {
  const dueAt = order.deliveredAt ? new Date(order.deliveredAt.getTime() + payoutDelayDays() * 86_400_000) : null;
  const base = { dueAt: dueAt?.toISOString() ?? null, amountCents: order.sellerNetCents };
  if (order.payout) return { ...base, status: "PAID", paidAt: order.payout.paidAt.toISOString() };
  // Without a payment account there is nothing to wait for but the seller, so they are asked before the parcel arrives.
  if (!order.seller.payoutAccountId) return { ...base, status: "WAITING_FOR_ACCOUNT", paidAt: null };
  return { ...base, status: dueAt ? "SCHEDULED" : "NOT_DELIVERED", paidAt: null };
}

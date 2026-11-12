import type { Prisma as PrismaNamespace } from "@auction/db";

export type OutboxKind = "LOST" | "WON" | "PAID" | "SOLD" | "EXPIRED" | "NOT_PAID" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "PAYOUT" | "ENDING_SOON" | "REMOVED" | "SELLER_SUSPENDED" | "ORDER_CANCELLED";

// What queueing an email does when a row for the same person, listing and kind is still waiting. "reschedule" makes it due
// again with fresh tries (a later round, or a changed time, must be told too); "keep" leaves the waiting row alone.
const WHEN_ALREADY_QUEUED: Record<OutboxKind, "keep" | "reschedule"> = {
  LOST: "keep",
  REMOVED: "keep",
  PAID: "keep",
  SOLD: "keep",
  SHIPPED: "keep",
  IN_TRANSIT: "keep",
  DELIVERED: "keep",
  PAYOUT: "keep",
  ORDER_CANCELLED: "keep",
  // Banned, restored and banned again: the new pause is told too.
  SELLER_SUSPENDED: "reschedule",
  WON: "reschedule",
  EXPIRED: "reschedule",
  NOT_PAID: "reschedule",
  ENDING_SOON: "reschedule",
};

type Tx = Pick<PrismaNamespace.TransactionClient, "pendingEndEmail">;

// Queues an email for MailOutbox to send. Call it inside the transaction that makes the email owed, so one cannot exist without the other.
export async function queueMail(tx: Tx, mail: { userId: string; listingId: string; kind: OutboxKind; dueAt?: Date }) {
  const { userId, listingId, kind, dueAt } = mail;
  await tx.pendingEndEmail.upsert({
    where: { userId_listingId_kind: { userId, listingId, kind } },
    create: { userId, listingId, kind, ...(dueAt ? { dueAt } : {}) },
    update: WHEN_ALREADY_QUEUED[kind] === "reschedule" ? { dueAt: dueAt ?? new Date(), attempts: 0 } : {},
  });
}

import { platformFeeCents } from "@auction/shared";
import type { Prisma as PrismaNamespace } from "@auction/db";
import { paymentWindowHours, platformFeeCapCents, platformFeePercent } from "../config";
import { queueMail } from "../email/mail-outbox";

type Tx = Pick<PrismaNamespace.TransactionClient, "order" | "pendingEndEmail">;

// Offers a listing to a buyer to pay for: creates their order with the platform fee, the seller's share and the payment deadline
// (the payment window after `startedAt`), and queues their "pay now" email. Call it inside the transaction that decides the buyer.
// `round` is 1 for the winner and goes up by one for each runner-up the item is offered to.
export async function offerItem(
  tx: Tx,
  offer: { listingId: string; buyerId: string; sellerId: string; amountCents: number; pickupAddress: PrismaNamespace.JsonValue | null; startedAt: Date; round?: number; mailDueAt?: Date },
) {
  const feeCents = platformFeeCents(offer.amountCents, platformFeePercent(), platformFeeCapCents());
  const order = await tx.order.create({
    data: {
      listingId: offer.listingId,
      ...(offer.round ? { round: offer.round } : {}),
      buyerId: offer.buyerId,
      sellerId: offer.sellerId,
      amountCents: offer.amountCents,
      feeCents,
      sellerNetCents: offer.amountCents - feeCents,
      ...(offer.pickupAddress ? { pickupAddress: offer.pickupAddress } : {}),
      payBy: new Date(offer.startedAt.getTime() + paymentWindowHours() * 3600_000),
    },
  });
  await queueMail(tx, { userId: offer.buyerId, listingId: offer.listingId, kind: "WON", ...(offer.mailDueAt ? { dueAt: offer.mailDueAt } : {}) });
  return order;
}

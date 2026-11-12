import { LISTING_PAGE_ENDED_DAYS } from "@auction/shared";
import type { Prisma } from "../db/db.module";

const DAY_MS = 86_400_000;

// An auction that ended more than LISTING_PAGE_ENDED_DAYS ago is no longer open to everyone.
export const pageExpired = (endsAt: Date | null, now = Date.now()) => !!endsAt && endsAt.getTime() < now - LISTING_PAGE_ENDED_DAYS * DAY_MS;

// Who can still open an old listing: the seller, the winner, anyone who bid on it and anyone with an order on it.
export async function hasStake(prisma: Prisma, listing: { id: string; sellerId: string; winnerId: string | null }, viewerId?: string) {
  if (!viewerId) return false;
  if (viewerId === listing.sellerId || viewerId === listing.winnerId) return true;
  const [bids, orders] = await Promise.all([
    prisma.bid.count({ where: { listingId: listing.id, bidderId: viewerId } }),
    prisma.order.count({ where: { listingId: listing.id, buyerId: viewerId } }),
  ]);
  return bids + orders > 0;
}

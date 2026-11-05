import { extensionCeiling, isFinalChance, listingPhase } from "@auction/shared";

// The fields a listing card needs, from a listing with its cover photo loaded. Used by the watchlist and seller profiles.
export const listingCardInclude = { images: { orderBy: { position: "asc" as const }, take: 1 } };

interface CardRow {
  id: string;
  title: string;
  startingPriceCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  durationDays: number;
  status: "DRAFT" | "PUBLISHED";
  currentBidCents: number | null;
  bidCount: number;
  images: { id: string; url: string }[];
}

export const toListingCard = (l: CardRow, now = new Date()) => ({
  id: l.id,
  title: l.title,
  startingPriceCents: l.startingPriceCents,
  phase: listingPhase(l, now),
  startsAt: l.startsAt,
  endsAt: l.endsAt,
  images: l.images.map((i) => ({ id: i.id, url: i.url })),
  finalChance: l.startsAt && l.endsAt ? isFinalChance(l.endsAt, extensionCeiling(l.startsAt, l.durationDays)) : false,
  currentBidCents: l.currentBidCents,
  bidCount: l.bidCount,
});

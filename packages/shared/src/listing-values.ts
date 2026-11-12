// Listing values and helpers with no zod, so client components that import them do not pull the schemas into the browser bundle.
export const LISTING_CONDITIONS = ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export const CONDITION_LABELS: Record<ListingCondition, string> = {
  NEW: "New",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
};

export const AUCTION_DURATIONS = [1, 3, 5, 7, 30] as const;
export type AuctionDuration = (typeof AUCTION_DURATIONS)[number];

/** "1 day", "7 days", and "30 days (1 month)". */
export function formatDuration(days: number): string {
  if (days === 30) return "30 days (1 month)";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MIN_STARTING_PRICE_CENTS = 100;
export const MAX_PRICE_CENTS = 100_000_000;
export const MAX_SCHEDULE_AHEAD_DAYS = 30;

/** Parses what a person types ("12", "12.5", "12,50") into integer cents, or null if it is not a valid amount. */
export function eurosToCents(input: string | number): number | null {
  const text = String(input).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatEur(cents: number): string {
  return `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type ListingPhase = "draft" | "upcoming" | "live" | "ended";

export function listingPhase(
  listing: { status: "DRAFT" | "PUBLISHED"; startsAt: Date | string | null; endsAt: Date | string | null },
  now: Date = new Date(),
): ListingPhase {
  if (listing.status === "DRAFT" || !listing.startsAt || !listing.endsAt) return "draft";
  if (now < new Date(listing.startsAt)) return "upcoming";
  if (now < new Date(listing.endsAt)) return "live";
  return "ended";
}

// Permission to upload a photo is given to a signed-in person this many times an hour and a day. A listing holds 8 photos and an
// edit may replace them a few times, so real use stays far below; the limit stops a script filling the photo store.
export const UPLOAD_HOURLY_RATE_LIMIT = { limit: 30, windowSeconds: 3600 } as const;
export const UPLOAD_DAILY_RATE_LIMIT = { limit: 100, windowSeconds: 86_400 } as const;

// How long after an auction ends it stays on a watchlist, and how long its page stays open to everyone. After the page's time only
// people with a stake (the seller, the winner, anyone who bid or has an order on it) can open it; everyone else gets "not found".
export const WATCHLIST_ENDED_DAYS = 7;
export const LISTING_PAGE_ENDED_DAYS = 30;

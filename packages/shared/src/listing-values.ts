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

export const PRICE_FILTER_HINT = "Use an amount (198 finds 198.00 to 198.99, 198.85 only that) or a range (10-50, 10- or -50).";
export const COUNT_FILTER_HINT = "Use a whole number (3) or a range (1-5, 1- or -5).";
export const COUNT_FILTER_MAX = 1_000_000;

export type NumberRange = { min: number | null; max: number | null };

// One amount (exact), a range "10-50", or an open one ("10-" and "-50"); the low end may not be above the high end, and a bound may
// not be above `limit`. `one` reads a single bound.
function parseRange(text: string, one: (part: string) => number | null, limit: number): NumberRange | null {
  if (text.length === 0 || text.length > 30 || /\s/.test(text)) return null;
  const parts = text.split("-");
  if (parts.length > 2) return null;
  const [low, high] = parts.length === 1 ? [parts[0], parts[0]] : parts;
  if (parts.length === 2 && low === "" && high === "") return null;
  const min = low === "" ? null : one(low);
  const max = high === "" ? null : one(high);
  if ((low !== "" && min === null) || (high !== "" && max === null)) return null;
  if ((min !== null && min > limit) || (max !== null && max > limit)) return null;
  if (min !== null && max !== null && min > max) return null;
  return { min, max };
}

/**
 * Reads a price search typed in an admin table, in euros with an optional € sign ("45", "10-50", "10-", "-50"). A single amount finds
 * every price that starts with it: "198" is 198.00 to 198.99, "198.8" is 198.80 to 198.89, "198.85" is just that. A range uses its two
 * ends as typed. Gives the bounds in cents (null = no bound), or null when it is not one of those, a bound is above `MAX_PRICE_CENTS`,
 * or the low end is above the high end.
 */
export function parsePriceFilter(input: string): NumberRange | null {
  // Spaces next to a dash or a € sign are fine ("10 - 50"); one between digits ("10 20") is not an amount.
  const text = input.trim().replace(/\s*([-€])\s*/g, "$1").replace(/€/g, "");
  const range = parseRange(text, eurosToCents, MAX_PRICE_CENTS);
  if (!range || range.min === null || range.max === null || text.includes("-")) return range;
  // One amount: the digits typed so far, not a price to the cent.
  if (/^\d+$/.test(text)) return { min: range.min, max: range.max + 99 };
  if (/^\d+[.,]\d$/.test(text)) return { min: range.min, max: range.max + 9 };
  return range;
}

/** The same for a count (bids, listings, strikes): whole numbers only, up to `COUNT_FILTER_MAX`. */
export function parseCountFilter(input: string): NumberRange | null {
  return parseRange(input.trim().replace(/\s*-\s*/g, "-"), (part) => (/^\d{1,7}$/.test(part) ? Number(part) : null), COUNT_FILTER_MAX);
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

import { z } from "zod";

// The minimum rise is the larger of €1 and 5% of the current bid. The 5% is a config value.
export const MIN_BID_INCREMENT_CENTS = 100;
export const BID_INCREMENT_PERCENT = 5;

// Anti-sniping, in two steps and no more. The first bid in the last 5 minutes sets the end to 15 minutes after that bid.
// Once that has happened, a bid in the last 60 seconds sets the end to 5 minutes after it. After those two, the end
// time never moves again, so an auction cannot be extended for ever.
export const ANTI_SNIPING_STEPS = [
  { windowMs: 5 * 60 * 1000, extensionMs: 15 * 60 * 1000 },
  { windowMs: 60 * 1000, extensionMs: 5 * 60 * 1000 },
] as const;
export const MAX_EXTENSIONS = ANTI_SNIPING_STEPS.length;

// True once the last extension has been used: the auction cannot be extended again, so this is the final chance to bid.
export const isFinalChance = (extensionCount: number | null | undefined) => (extensionCount ?? 0) >= MAX_EXTENSIONS;

// The most a single bid may be (EUR 10 million). It sits far below the 32-bit limit of the price columns, so the minimum
// for the next bid always fits too. Past about EUR 9.5 million the next minimum is above this cap, so nobody can outbid.
export const MAX_BID_CENTS = 1_000_000_000;

// The least the next bid may be, in cents. With no bids yet it is the starting price; after that it is the current bid
// plus the rise, rounded up to a whole cent. Examples: €10 -> €11, €100 -> €105, €1,000 -> €1,050.
export function minimumNextBidCents(
  listing: { startingPriceCents: number; currentBidCents: number | null },
  percent: number = BID_INCREMENT_PERCENT,
): number {
  if (listing.currentBidCents === null) return listing.startingPriceCents;
  const rise = Math.max(MIN_BID_INCREMENT_CENTS, Math.ceil((listing.currentBidCents * percent) / 100));
  return listing.currentBidCents + rise;
}

// The end time after a bid placed at `bidAt`, and how many extensions the auction has used by then. `extensionCount` is
// how many it had used before this bid. The end never moves earlier, and a bid after the end changes nothing.
export function endsAtAfterBid(
  endsAt: Date,
  bidAt: Date,
  extensionCount: number,
): { endsAt: Date; extensionCount: number; extended: boolean } {
  const unchanged = { endsAt, extensionCount, extended: false };
  const step = ANTI_SNIPING_STEPS[extensionCount];
  if (!step) return unchanged;
  const left = endsAt.getTime() - bidAt.getTime();
  if (left <= 0 || left > step.windowMs) return unchanged;
  const newEnd = new Date(Math.max(endsAt.getTime(), bidAt.getTime() + step.extensionMs));
  return { endsAt: newEnd, extensionCount: extensionCount + 1, extended: true };
}

// What the bidder sends. The key makes a retry harmless: the same key never places two bids.
export const placeBidSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: "Enter your bid" })
    .int("Enter your bid")
    .min(1, "Enter your bid")
    .max(MAX_BID_CENTS, "That bid is too high"),
  idempotencyKey: z
    .string()
    .min(8, "Missing bid key")
    .max(64, "Missing bid key")
    .regex(/^[A-Za-z0-9_-]+$/, "Missing bid key"),
});

export type PlaceBidInput = z.infer<typeof placeBidSchema>;

// Why a bid is refused, so the page can say it in words and the audit log can record it.
export const BID_REFUSALS = [
  "NOT_FOUND",
  "NOT_LIVE",
  "OWN_LISTING",
  "ALREADY_HIGHEST",
  "TOO_LOW",
  "RATE_LIMITED",
] as const;
export type BidRefusal = (typeof BID_REFUSALS)[number];

export const BID_REFUSAL_MESSAGES: Record<BidRefusal, string> = {
  NOT_FOUND: "This auction does not exist.",
  NOT_LIVE: "This auction is not open for bids.",
  OWN_LISTING: "You cannot bid on your own listing.",
  ALREADY_HIGHEST: "You already have the highest bid.",
  TOO_LOW: "Your bid is below the minimum.",
  RATE_LIMITED: "You are bidding too fast. Wait a moment and try again.",
};

import { z } from "zod";

export const LISTING_CONDITIONS = ["NEW", "LIKE_NEW", "GOOD", "FAIR", "FOR_PARTS"] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export const CONDITION_LABELS: Record<ListingCondition, string> = {
  NEW: "New",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  FOR_PARTS: "For parts or repair",
};

export const AUCTION_DURATIONS = [1, 3, 5, 7] as const;
export type AuctionDuration = (typeof AUCTION_DURATIONS)[number];

export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MIN_STARTING_PRICE_CENTS = 100;
export const MAX_PRICE_CENTS = 100_000_000;
export const MAX_SCHEDULE_AHEAD_DAYS = 30;

const priceField = (label: string) =>
  z
    .number({ invalid_type_error: `Enter ${label}` })
    .int(`Enter ${label}`)
    .max(MAX_PRICE_CENTS, `${label[0].toUpperCase()}${label.slice(1)} is too high`);

const listingFields = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(80, "Title must be at most 80 characters"),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(4000, "Description must be at most 4000 characters"),
  categoryId: z.string().min(1, "Choose a category"),
  condition: z.enum(LISTING_CONDITIONS, { errorMap: () => ({ message: "Choose a condition" }) }),
  startingPriceCents: priceField("a starting price").min(MIN_STARTING_PRICE_CENTS, "Starting price must be at least €1.00"),
  reservePriceCents: priceField("a reserve price").nullable(),
  durationDays: z
    .number()
    .refine((d): d is AuctionDuration => (AUCTION_DURATIONS as readonly number[]).includes(d), "Choose 1, 3, 5, or 7 days"),
});

const reserveNotBelowStart = {
  message: "Reserve price cannot be lower than the starting price",
  path: ["reservePriceCents"],
};

type ListingFields = z.infer<typeof listingFields>;
const reserveOk = (d: Partial<ListingFields>) =>
  d.reservePriceCents == null || d.startingPriceCents == null || d.reservePriceCents >= d.startingPriceCents;

export const createListingSchema = listingFields.refine(reserveOk, reserveNotBelowStart);
// Updates may send any subset; the API validates the merged result with createListingSchema.
export const updateListingSchema = listingFields.partial().refine(reserveOk, reserveNotBelowStart);
// After publishing, only the description can change.
export const updatePublishedListingSchema = listingFields.pick({ description: true });

export const listingImagesSchema = z
  .array(z.object({ url: z.string().url(), pathname: z.string().min(1) }))
  .max(MAX_IMAGES, `You can add up to ${MAX_IMAGES} photos`)
  .refine((images) => new Set(images.map((i) => i.pathname)).size === images.length, "Photos must be different files");

export const publishListingSchema = z.object({
  // Omit to start now; otherwise an ISO time no earlier than now and no more than 30 days ahead.
  startsAt: z
    .string()
    .datetime()
    .optional()
    .refine((v) => v === undefined || new Date(v).getTime() >= Date.now() - 60_000, "Start time cannot be in the past")
    .refine(
      (v) => v === undefined || new Date(v).getTime() <= Date.now() + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000,
      `Start time must be within ${MAX_SCHEDULE_AHEAD_DAYS} days`,
    ),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type UpdatePublishedListingInput = z.infer<typeof updatePublishedListingSchema>;
export type ListingImageInput = z.infer<typeof listingImagesSchema>[number];
export type PublishListingInput = z.infer<typeof publishListingSchema>;

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

import { z } from "zod";
import { pickupAddressSchema } from "./shipping";
import { AUCTION_DURATIONS, LISTING_CONDITIONS, MAX_IMAGES, MAX_PRICE_CENTS, MAX_SCHEDULE_AHEAD_DAYS, MIN_STARTING_PRICE_CENTS, type AuctionDuration, type ListingPhase } from "./listing-values";

export * from "./listing-values";
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
    .refine((d): d is AuctionDuration => (AUCTION_DURATIONS as readonly number[]).includes(d), "Choose 1, 3, 5, 7, or 30 days"),
  // Where our carrier collects the item. Optional while drafting; the API requires it to publish. Never shown to buyers.
  pickupAddress: pickupAddressSchema.optional(),
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

// What a listing card shows, as the API sends it (the home page, search, the watchlist and a seller's profile all use it).
export interface ListingCardData {
  id: string;
  title: string;
  startingPriceCents: number;
  phase: ListingPhase;
  startsAt: string | null;
  endsAt: string | null;
  images: { id: string; url: string }[];
  finalChance: boolean;
  currentBidCents: number | null;
  bidCount: number;
}

import { z } from "zod";

// After an order is delivered, its buyer rates the seller once: 1 to 5 stars and, if they like, a short comment. Ratings are
// public on the seller's profile (with the buyer's username, never their name) and cannot be changed or removed by the buyer.
export const RATING_COMMENT_MAX = 500;
export const PROFILE_RATINGS_SHOWN = 20;
// A seller rated below this (out of 5), by at least LOW_RATING_MIN_COUNT buyers, gets a warning on their listings. The minimum
// stops a single unhappy buyer from flagging a seller.
export const LOW_RATING_THRESHOLD = 3.5;
export const LOW_RATING_MIN_COUNT = 3;

export const isLowRating = (average: number | null, count: number) => average !== null && count >= LOW_RATING_MIN_COUNT && average < LOW_RATING_THRESHOLD;
export const PROFILE_LISTINGS_SHOWN = 12;

export const rateSellerSchema = z.object({
  stars: z.number({ required_error: "Choose 1 to 5 stars", invalid_type_error: "Choose 1 to 5 stars" }).int("Choose 1 to 5 stars").min(1, "Choose 1 to 5 stars").max(5, "Choose 1 to 5 stars"),
  comment: z
    .string()
    .trim()
    .max(RATING_COMMENT_MAX, `Keep the comment under ${RATING_COMMENT_MAX} characters`)
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type RateSellerInput = z.infer<typeof rateSellerSchema>;

export interface RatingView {
  stars: number;
  comment: string | null;
  createdAt: string;
}

// A seller's public page: username only (real names stay private), how they are rated, and what they have on sale.
export interface SellerProfile {
  username: string;
  memberSince: string;
  rating: { average: number | null; count: number };
  ratings: (RatingView & { id: string; buyer: { username: string }; listingTitle: string })[];
  listings: import("./listings").ListingCardData[];
}

import { z } from "zod";
import { LISTING_CONDITIONS, MAX_PRICE_CENTS } from "./listings";

export const SEARCH_SORTS = ["relevance", "endingSoon", "newest", "mostBids", "priceAsc", "priceDesc"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  relevance: "Best match",
  endingSoon: "Ending soonest",
  newest: "Newest",
  mostBids: "Most bids",
  priceAsc: "Price: low to high",
  priceDesc: "Price: high to low",
};

export const ENDING_SOON_HOURS = 24;

const cents = z.coerce.number().int().min(0).max(MAX_PRICE_CENTS);

export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    category: z.string().regex(/^[a-z0-9-]+$/).max(50).optional(),
    condition: z.enum(LISTING_CONDITIONS).optional(),
    minPriceCents: cents.optional(),
    maxPriceCents: cents.optional(),
    endingSoon: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    sort: z.enum(SEARCH_SORTS).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(24),
  })
  .refine((v) => v.minPriceCents === undefined || v.maxPriceCents === undefined || v.minPriceCents <= v.maxPriceCents, {
    message: "The minimum price cannot be above the maximum",
    path: ["minPriceCents"],
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

// Best match only means something when there is text to match; without text, newest first.
export function resolveSearchSort(query: Pick<SearchQuery, "q" | "sort">): SearchSort {
  if (query.sort && !(query.sort === "relevance" && !query.q)) return query.sort;
  return query.q ? "relevance" : "newest";
}

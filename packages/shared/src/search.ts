import { z } from "zod";
import { LISTING_CONDITIONS, MAX_PRICE_CENTS } from "./listing-values";
import { MAX_SEARCH_RESULTS, SEARCH_SORTS, SUGGESTION_MIN_LENGTH } from "./search-values";

export * from "./search-values";

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
  .refine((v) => v.page * v.pageSize <= MAX_SEARCH_RESULTS, {
    message: `Search shows at most the first ${MAX_SEARCH_RESULTS} results. Narrow the search with a filter.`,
    path: ["page"],
  })
  .refine((v) => v.minPriceCents === undefined || v.maxPriceCents === undefined || v.minPriceCents <= v.maxPriceCents, {
    message: "The minimum price cannot be above the maximum",
    path: ["minPriceCents"],
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const suggestQuerySchema = z.object({ q: z.string().trim().min(SUGGESTION_MIN_LENGTH).max(100) });

// Per address, because search is public. Far above what a person clicking around reaches (suggestions fire while typing, a few a second
// at most), so only a script gets near them.
export const SEARCH_RATE_LIMIT = { limit: 300, windowSeconds: 60 } as const;
export const SUGGEST_RATE_LIMIT = { limit: 120, windowSeconds: 60 } as const;

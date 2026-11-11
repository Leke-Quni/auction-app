import { z } from "zod";
import { LISTING_CONDITIONS, MAX_PRICE_CENTS } from "./listing-values";
import { SEARCH_SORTS, SUGGESTION_MIN_LENGTH } from "./search-values";

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
  .refine((v) => v.minPriceCents === undefined || v.maxPriceCents === undefined || v.minPriceCents <= v.maxPriceCents, {
    message: "The minimum price cannot be above the maximum",
    path: ["minPriceCents"],
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const suggestQuerySchema = z.object({ q: z.string().trim().min(SUGGESTION_MIN_LENGTH).max(100) });

import { LISTING_CONDITIONS, eurosToCents, maxSearchPage, type ListingCondition } from "@auction/shared";

export const SEARCH_PAGE_SIZE = 24;

export interface SearchPageParams {
  q?: string;
  category?: string;
  condition?: string;
  minPrice?: string;
  maxPrice?: string;
  endingSoon?: string;
  sort?: string;
  page?: string;
}

const KEYS = ["q", "category", "condition", "minPrice", "maxPrice", "endingSoon", "sort", "page"] as const;

// The conditions a visitor ticked, as a list in the order the form shows them: "GOOD,NEW" and a repeated parameter both
// become "NEW,GOOD", and a value that is not a condition is dropped.
export function conditionList(value: string | undefined): ListingCondition[] {
  const wanted = new Set((value ?? "").split(",").map((part) => part.trim()));
  return LISTING_CONDITIONS.filter((condition) => wanted.has(condition));
}

// Next hands over a string or a list of strings; an empty form field arrives as "". Keep the first value and drop blanks.
// Conditions are the exception: several can be ticked, so every value is kept.
export function readSearchParams(raw: Record<string, string | string[] | undefined>): SearchPageParams {
  const params: SearchPageParams = {};
  for (const key of KEYS) {
    if (key === "condition") {
      const conditions = conditionList((Array.isArray(raw.condition) ? raw.condition : [raw.condition ?? ""]).join(","));
      if (conditions.length > 0) params.condition = conditions.join(",");
      continue;
    }
    const value = Array.isArray(raw[key]) ? raw[key][0] : raw[key];
    if (value?.trim()) params[key] = value.trim();
  }
  return params;
}

// The browser's query string as the object `readSearchParams` takes, keeping every value of a repeated parameter
// (`Object.fromEntries` would keep only the last).
export function recordFromSearchParams(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    record[key] = values.length > 1 ? values : values[0];
  }
  return record;
}

// Turns what the visitor typed (prices in euros) into the API's query (prices in cents).
export function apiQueryFromParams(params: SearchPageParams): { query: URLSearchParams } | { error: string } {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.category) query.set("category", params.category);
  if (params.condition) query.set("condition", params.condition);
  for (const [field, apiField] of [["minPrice", "minPriceCents"], ["maxPrice", "maxPriceCents"]] as const) {
    if (!params[field]) continue;
    const cents = eurosToCents(params[field]);
    if (cents === null) return { error: "Enter prices as a number, like 25 or 25.50." };
    query.set(apiField, String(cents));
  }
  if (params.endingSoon === "true") query.set("endingSoon", "true");
  if (params.sort) query.set("sort", params.sort);
  const page = Number.parseInt(params.page ?? "1", 10);
  query.set("page", String(Math.min(maxSearchPage(SEARCH_PAGE_SIZE), Math.max(1, Number.isNaN(page) ? 1 : page))));
  query.set("pageSize", String(SEARCH_PAGE_SIZE));
  return { query };
}

export function pageHref(params: SearchPageParams, page: number) {
  const query = new URLSearchParams();
  for (const key of KEYS) if (key !== "page" && params[key]) query.set(key, params[key]);
  if (page > 1) query.set("page", String(page));
  return query.size > 0 ? `/search?${query}` : "/search";
}

// A link that switches category and keeps the rest of the search; the page resets to 1.
export function categoryHref(params: SearchPageParams, slug?: string) {
  return pageHref({ ...params, category: slug, page: undefined }, 1);
}

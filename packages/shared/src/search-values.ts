// Search values with no zod, so client components that import them do not pull the schemas into the browser bundle.
export const SEARCH_SORTS = ["relevance", "endingSoon", "endingLatest", "newest", "mostBids", "fewestBids", "priceAsc", "priceDesc"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  relevance: "Best match",
  endingSoon: "Ending soonest",
  endingLatest: "Ending latest",
  newest: "Newest",
  mostBids: "Most bids",
  fewestBids: "Fewest bids",
  priceAsc: "Price: low to high",
  priceDesc: "Price: high to low",
};

export const ENDING_SOON_HOURS = 24;

// Suggestions while typing: a few listing titles that match the text so far. Shorter text matches too much to help.
export const SUGGESTION_MIN_LENGTH = 2;
export const SUGGESTION_COUNT = 5;

// Best match only means something when there is text to match; without text, newest first.
export function resolveSearchSort(query: { q?: string; sort?: SearchSort }): SearchSort {
  if (query.sort && !(query.sort === "relevance" && !query.q)) return query.sort;
  return query.q ? "relevance" : "newest";
}

// Deep pages cost the most and nobody reads them: a search shows at most this many results (page times page size), and a person
// who needs more narrows it with a filter.
export const MAX_SEARCH_RESULTS = 2000;
export const maxSearchPage = (pageSize: number) => Math.max(1, Math.floor(MAX_SEARCH_RESULTS / pageSize));

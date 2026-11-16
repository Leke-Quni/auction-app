import { COUNT_FILTER_HINT, parseCountFilter, parsePriceFilter, PRICE_FILTER_HINT } from "@auction/shared";

// The settings a column of each kind shares in every table: how it sorts, what its search box takes and refuses. The checks are the
// API's own (`packages/shared`), so what the menu accepts the API accepts.
export const COUNT_COLUMN = {
  sortable: true,
  searchable: true,
  descFirst: true,
  sortLabels: { asc: "Low to high", desc: "High to low" },
  searchHint: "e.g. 3 or 1-5",
  validateSearch: (text: string) => (parseCountFilter(text) ? null : COUNT_FILTER_HINT),
} as const;

export const PRICE_COLUMN = {
  sortable: true,
  searchable: true,
  descFirst: true,
  sortLabels: { asc: "Low to high", desc: "High to low" },
  searchHint: "e.g. 198 or 10-50",
  validateSearch: (text: string) => (parsePriceFilter(text) ? null : PRICE_FILTER_HINT),
} as const;

export const DATE_COLUMN = {
  sortable: true,
  descFirst: true,
  sortLabels: { asc: "Oldest to latest", desc: "Latest to oldest" },
} as const;

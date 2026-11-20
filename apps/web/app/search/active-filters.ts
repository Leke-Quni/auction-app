import { CONDITION_LABELS } from "@auction/shared";
import { categoryList, conditionList, pageHref, type SearchPageParams } from "./search-params";

export interface FilterChip {
  id: string;
  label: string;
  href: string;
}

// The filters that stay on when the text search changes (the text itself and the page do not).
const CARRIED = ["category", "condition", "minPrice", "maxPrice", "endingSoon", "sort"] as const;

export function carriedFilters(params: SearchPageParams): [string, string][] {
  return CARRIED.flatMap((key) => (params[key] ? [[key, params[key]] as [string, string]] : []));
}

const without = (params: SearchPageParams, keys: (keyof SearchPageParams)[]) =>
  pageHref({ ...params, ...Object.fromEntries(keys.map((key) => [key, undefined])), page: undefined }, 1);

// Once a category is chosen: one chip for each category not chosen yet, linking to the same search with it added, so a search can
// grow to several. None while no category is chosen (the sidebar lists them all then), and none when all are.
export function addCategoryChips(params: SearchPageParams, categories: { slug: string; name: string }[]): FilterChip[] {
  const chosen = categoryList(params.category);
  if (chosen.length === 0) return [];
  return categories
    .filter((c) => !chosen.includes(c.slug))
    .map((c) => ({ id: `add-category-${c.slug}`, label: c.name, href: pageHref({ ...params, category: [...chosen, c.slug].join(","), page: undefined }, 1) }));
}

// One chip per active filter, each linking to the same search without it. Sort is a choice, not a filter, so it has none.
export function activeFilterChips(params: SearchPageParams, categories: { slug: string; name: string }[]): FilterChip[] {
  const chips: FilterChip[] = [];
  // One chip per chosen category; removing one keeps the others.
  const chosen = categoryList(params.category);
  for (const slug of chosen) {
    const name = categories.find((c) => c.slug === slug)?.name ?? slug;
    const rest = chosen.filter((s) => s !== slug).join(",");
    chips.push({ id: `category-${slug}`, label: name, href: pageHref({ ...params, category: rest || undefined, page: undefined }, 1) });
  }
  // One chip per ticked condition; removing one keeps the others.
  const conditions = conditionList(params.condition);
  for (const condition of conditions) {
    const rest = conditions.filter((c) => c !== condition).join(",");
    chips.push({ id: `condition-${condition}`, label: CONDITION_LABELS[condition], href: pageHref({ ...params, condition: rest || undefined, page: undefined }, 1) });
  }
  if (params.minPrice || params.maxPrice) {
    const label =
      params.minPrice && params.maxPrice
        ? `€${params.minPrice} – €${params.maxPrice}`
        : params.minPrice
          ? `From €${params.minPrice}`
          : `Up to €${params.maxPrice}`;
    chips.push({ id: "price", label, href: without(params, ["minPrice", "maxPrice"]) });
  }
  if (params.endingSoon === "true") {
    chips.push({ id: "endingSoon", label: "Ending within 24 hours", href: without(params, ["endingSoon"]) });
  }
  return chips;
}

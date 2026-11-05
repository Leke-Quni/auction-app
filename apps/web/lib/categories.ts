import { cache } from "react";
import { apiFetch, rarelyChanging } from "@/lib/api";

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
}

// A fixed list of ten, so it is kept for an hour. `cache` makes the header and the page share one answer within a request.
export const loadCategories = cache(async (): Promise<CategoryOption[]> => {
  try {
    const res = await apiFetch("/categories", rarelyChanging(3600));
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
});

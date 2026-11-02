import { apiFetch } from "@/lib/api";

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
}

export async function loadCategories(): Promise<CategoryOption[]> {
  try {
    const res = await apiFetch("/categories");
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

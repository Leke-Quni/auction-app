import { NoopSearchIndex, type SearchIndex } from "./search-index";
import { TypesenseSearchIndex } from "./typesense-search-index";

export function createSearchIndex(env: Record<string, string | undefined> = process.env): SearchIndex {
  const url = env.TYPESENSE_URL?.trim();
  const apiKey = env.TYPESENSE_API_KEY?.trim();
  if (url && apiKey) return new TypesenseSearchIndex(url.replace(/\/$/, ""), apiKey, env.TYPESENSE_COLLECTION?.trim() || undefined);
  return new NoopSearchIndex();
}

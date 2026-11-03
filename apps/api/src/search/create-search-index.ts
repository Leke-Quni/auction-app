import type { Prisma } from "../db/db.module";
import { PostgresSearchIndex } from "./postgres-search-index";
import { NoopSearchIndex, type SearchIndex } from "./search-index";
import { TypesenseSearchIndex } from "./typesense-search-index";

export function createSearchIndex(env: Record<string, string | undefined> = process.env, prisma?: Prisma): SearchIndex {
  const url = env.TYPESENSE_URL?.trim();
  const apiKey = env.TYPESENSE_API_KEY?.trim();
  if (url && apiKey) return new TypesenseSearchIndex(url.replace(/\/$/, ""), apiKey, env.TYPESENSE_COLLECTION?.trim() || undefined);
  // Without Typesense, search the database directly so deployed environments still have working filters.
  return prisma ? new PostgresSearchIndex(prisma) : new NoopSearchIndex();
}

import { Injectable } from "@nestjs/common";

export const SEARCH_INDEX = Symbol("SEARCH_INDEX");

// Times are Unix seconds so Typesense can filter and sort on them.
export interface ListingDocument {
  id: string;
  title: string;
  description: string;
  category_slug: string;
  condition: string;
  price_cents: number;
  bid_count: number;
  starts_at: number;
  ends_at: number;
  published_at: number;
  seller_username: string;
  cover_url?: string;
}

export interface SearchIndex {
  ensureReady(): Promise<void>;
  upsert(doc: ListingDocument): Promise<void>;
  remove(id: string): Promise<void>;
  removeEnded(now: Date): Promise<void>;
  replaceAll(docs: ListingDocument[]): Promise<void>;
}

// Used when Typesense is not configured (tests, deployed environments without search).
@Injectable()
export class NoopSearchIndex implements SearchIndex {
  async ensureReady() {}
  async upsert() {}
  async remove() {}
  async removeEnded() {}
  async replaceAll() {}
}

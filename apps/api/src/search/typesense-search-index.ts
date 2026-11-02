import { ENDING_SOON_HOURS, type SearchSort } from "@auction/shared";
import { Logger } from "@nestjs/common";
import type { ListingDocument, LiveFields, SearchIndex, SearchParams } from "./search-index";
import { LISTING_SYNONYMS, SYNONYM_SET } from "./synonyms";

const SCHEMA_FIELDS = [
  { name: "title", type: "string" },
  { name: "description", type: "string" },
  { name: "category_slug", type: "string", facet: true },
  { name: "condition", type: "string", facet: true },
  { name: "price_cents", type: "int32" },
  { name: "bid_count", type: "int32" },
  { name: "final_chance", type: "bool", index: false, optional: true },
  { name: "starts_at", type: "int64" },
  { name: "ends_at", type: "int64" },
  { name: "published_at", type: "int64" },
  { name: "seller_username", type: "string", index: false, optional: true },
  { name: "cover_url", type: "string", index: false, optional: true },
];

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

const SORT_BY: Record<SearchSort, string> = {
  relevance: "_text_match:desc,ends_at:asc",
  endingSoon: "ends_at:asc",
  newest: "published_at:desc",
  mostBids: "bid_count:desc,ends_at:asc",
  priceAsc: "price_cents:asc",
  priceDesc: "price_cents:desc",
};

// Typesense allows at most 2 typos in a word, so "jjjjeans" (three extra letters) can never match "jeans". Three or more of
// the same letter in a row are cut to two ("jjeans"), which is one typo away. Real words almost never repeat a letter 3 times.
export function normalizeQuery(q: string) {
  return q.replace(/(\p{L})\1{2,}/giu, "$1$1");
}

// Words of 4 or more letters may have 1 typo (Typesense's default) and words of 6 or more may have 2 (default is 7).
const MIN_LENGTH_FOR_TWO_TYPOS = "6";

// Values reaching these filters were validated by searchQuerySchema (slug characters, a fixed list of conditions, integers).
export function buildFilter(params: Pick<SearchParams, "category" | "condition" | "minPriceCents" | "maxPriceCents" | "endingSoon" | "now">) {
  const now = seconds(params.now);
  const filters = [`ends_at:>${now}`];
  if (params.category) filters.push(`category_slug:=${params.category}`);
  if (params.condition) filters.push(`condition:=${params.condition}`);
  if (params.minPriceCents !== undefined) filters.push(`price_cents:>=${params.minPriceCents}`);
  if (params.maxPriceCents !== undefined) filters.push(`price_cents:<=${params.maxPriceCents}`);
  if (params.endingSoon) filters.push(`starts_at:<=${now}`, `ends_at:<=${now + ENDING_SOON_HOURS * 3600}`);
  return filters.join(" && ");
}

export class TypesenseSearchIndex implements SearchIndex {
  private readonly logger = new Logger(TypesenseSearchIndex.name);
  private ready?: Promise<void>;
  private synonymsReady = false;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    readonly collection = "listings",
  ) {}

  ensureReady() {
    this.ready ??= this.prepare().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async upsert(doc: ListingDocument) {
    await this.ensureReady();
    await this.call(`/collections/${this.collection}/documents?action=upsert`, { method: "POST", body: JSON.stringify(doc) });
  }

  async update(id: string, fields: LiveFields) {
    await this.ensureReady();
    await this.call(`/collections/${this.collection}/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(fields), allow: [404] });
  }

  async remove(id: string) {
    await this.ensureReady();
    await this.call(`/collections/${this.collection}/documents/${encodeURIComponent(id)}?ignore_not_found=true`, { method: "DELETE" });
  }

  async removeEnded(now: Date) {
    await this.ensureReady();
    const filter = encodeURIComponent(`ends_at:<=${seconds(now)}`);
    await this.call(`/collections/${this.collection}/documents?filter_by=${filter}`, { method: "DELETE" });
  }

  async replaceAll(docs: ListingDocument[]) {
    await this.ensureReady();
    const documents = `/collections/${this.collection}/documents`;
    if (docs.length === 0) {
      await this.call(`${documents}?truncate=true`, { method: "DELETE" });
      return;
    }
    const res = await this.call(`${documents}/import?action=upsert`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: docs.map((doc) => JSON.stringify(doc)).join("\n"),
    });
    const failed = (await res.text()).split("\n").filter((line) => line && !JSON.parse(line).success);
    if (failed.length > 0) throw new Error(`Typesense rejected ${failed.length} documents: ${failed[0]}`);
    const keep = docs.map((doc) => doc.id).join(",");
    await this.call(`${documents}?filter_by=${encodeURIComponent(`id:!=[${keep}]`)}`, { method: "DELETE" });
  }

  async search(params: SearchParams) {
    await this.ensureReady();
    const query = new URLSearchParams({
      q: normalizeQuery(params.q) || "*",
      query_by: "title,description",
      min_len_2typo: MIN_LENGTH_FOR_TWO_TYPOS,
      query_by_weights: "3,1",
      filter_by: buildFilter(params),
      sort_by: SORT_BY[params.sort],
      page: String(params.page),
      per_page: String(params.pageSize),
    });
    if (this.synonymsReady) query.set("synonym_sets", SYNONYM_SET);
    const res = await this.call(`/collections/${this.collection}/documents/search?${query}`);
    const body = (await res.json()) as { found: number; hits: { document: ListingDocument }[] };
    return { documents: body.hits.map((hit) => hit.document), total: body.found };
  }

  private async prepare() {
    await this.createCollectionIfMissing();
    // Synonyms are a nicety (and need Typesense 30 or newer): if they cannot be loaded, search carries on without them.
    try {
      await this.putSynonyms();
      this.synonymsReady = true;
    } catch (error) {
      this.logger.warn(`Searching without synonyms: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Replaces the whole set, so removing a group from synonyms.ts removes it from Typesense too. Needs Typesense 30 or newer.
  private async putSynonyms() {
    await this.call(`/synonym_sets/${SYNONYM_SET}`, { method: "PUT", body: JSON.stringify({ items: LISTING_SYNONYMS }) });
  }

  private async createCollectionIfMissing() {
    const existing = await this.call(`/collections/${this.collection}`, { allow: [404] });
    if (existing.ok) return;
    await this.call("/collections", {
      method: "POST",
      body: JSON.stringify({ name: this.collection, fields: SCHEMA_FIELDS }),
      allow: [409],
    });
  }

  private async call(path: string, init: RequestInit & { allow?: number[] } = {}) {
    const { allow = [], ...rest } = init;
    const res = await fetch(`${this.url}${path}`, {
      ...rest,
      signal: AbortSignal.timeout(5000),
      headers: { "X-TYPESENSE-API-KEY": this.apiKey, "Content-Type": "application/json", ...rest.headers },
    });
    if (!res.ok && !allow.includes(res.status)) {
      throw new Error(`Typesense ${rest.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  }
}

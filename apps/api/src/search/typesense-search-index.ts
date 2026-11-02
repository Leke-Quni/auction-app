import type { ListingDocument, SearchIndex } from "./search-index";

const SCHEMA_FIELDS = [
  { name: "title", type: "string" },
  { name: "description", type: "string" },
  { name: "category_slug", type: "string", facet: true },
  { name: "condition", type: "string", facet: true },
  { name: "price_cents", type: "int32" },
  { name: "bid_count", type: "int32" },
  { name: "starts_at", type: "int64" },
  { name: "ends_at", type: "int64" },
  { name: "published_at", type: "int64" },
  { name: "seller_username", type: "string", index: false, optional: true },
  { name: "cover_url", type: "string", index: false, optional: true },
];

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export class TypesenseSearchIndex implements SearchIndex {
  private ready?: Promise<void>;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    readonly collection = "listings",
  ) {}

  ensureReady() {
    this.ready ??= this.createCollectionIfMissing().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async upsert(doc: ListingDocument) {
    await this.ensureReady();
    await this.call(`/collections/${this.collection}/documents?action=upsert`, { method: "POST", body: JSON.stringify(doc) });
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

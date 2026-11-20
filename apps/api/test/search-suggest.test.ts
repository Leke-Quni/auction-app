import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SearchController } from "../src/search/search.controller";
import { MemoryRateLimiter } from "../src/rate-limit/rate-limiter";
import type { ListingDocument, SearchIndex } from "../src/search/search-index";

const doc = (title: string, extra: Partial<ListingDocument> = {}): ListingDocument => ({
  id: title,
  title,
  description: "",
  category_slug: "art",
  condition: "GOOD",
  price_cents: 1000,
  bid_count: 0,
  starts_at: 0,
  ends_at: 0,
  published_at: 0,
  seller_username: "s",
  ...extra,
});

const controllerFor = (search: SearchIndex["search"]) => new SearchController({ search } as unknown as SearchIndex, new MemoryRateLimiter());
const req = { headers: {} };

describe("search suggestions", () => {
  it("asks the index for the best matches of the typed text and returns their titles, each once, at most five", async () => {
    const search = vi.fn().mockResolvedValue({
      documents: ["Old watch", "old WATCH", "Watch strap", "Watchmaker tools", "Watch box", "Watch case", "Watch dial", "Watch glass"].map((title) => doc(title)),
      total: 8,
    });
    const result = await controllerFor(search).suggest(req, { q: "wat" });
    expect(result.suggestions).toEqual(["Old watch", "Watch strap", "Watchmaker tools", "Watch box", "Watch case"]);
    expect(result.items.map((item) => item.title)).toEqual(result.suggestions);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: "wat", sort: "relevance", endingSoon: false, page: 1 }));
  });

  it("gives each suggestion's listing id, cover photo (or null) and current price so the box can show a picture and a price", async () => {
    const search = vi.fn().mockResolvedValue({
      documents: [doc("Old watch", { cover_url: "https://img/watch.jpg", price_cents: 2500, bid_count: 3 }), doc("Watch box")],
      total: 2,
    });
    const { items } = await controllerFor(search).suggest(req, { q: "wat" });
    expect(items).toEqual([
      { id: "Old watch", title: "Old watch", coverUrl: "https://img/watch.jpg", priceCents: 2500, hasBids: true },
      { id: "Watch box", title: "Watch box", coverUrl: null, priceCents: 1000, hasBids: false },
    ]);
  });

  it("answers an empty list when nothing matches, and 503 when the search is down", async () => {
    expect(await controllerFor(vi.fn().mockResolvedValue({ documents: [], total: 0 })).suggest(req, { q: "zzz" })).toEqual({ suggestions: [], items: [] });
    await expect(controllerFor(vi.fn().mockRejectedValue(new Error("down"))).suggest(req, { q: "wat" })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SearchController } from "../src/search/search.controller";
import type { ListingDocument, SearchIndex } from "../src/search/search-index";

const doc = (title: string): ListingDocument => ({
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
});

const controllerFor = (search: SearchIndex["search"]) => new SearchController({ search } as unknown as SearchIndex);

describe("search suggestions", () => {
  it("asks the index for the best matches of the typed text and returns their titles, each once, at most five", async () => {
    const search = vi.fn().mockResolvedValue({
      documents: ["Old watch", "old WATCH", "Watch strap", "Watchmaker tools", "Watch box", "Watch case", "Watch dial", "Watch glass"].map(doc),
      total: 8,
    });
    const result = await controllerFor(search).suggest({ q: "wat" });
    expect(result).toEqual({ suggestions: ["Old watch", "Watch strap", "Watchmaker tools", "Watch box", "Watch case"] });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: "wat", sort: "relevance", endingSoon: false, page: 1 }));
  });

  it("answers an empty list when nothing matches, and 503 when the search is down", async () => {
    expect(await controllerFor(vi.fn().mockResolvedValue({ documents: [], total: 0 })).suggest({ q: "zzz" })).toEqual({ suggestions: [] });
    await expect(controllerFor(vi.fn().mockRejectedValue(new Error("down"))).suggest({ q: "wat" })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

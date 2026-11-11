import { listingPhase, searchQuerySchema, resolveSearchSort, SEARCH_RATE_LIMIT, SUGGEST_RATE_LIMIT, SUGGESTION_COUNT, suggestQuerySchema, type SearchQuery } from "@auction/shared";
import { Controller, Get, HttpException, HttpStatus, Inject, Logger, Query, Req, ServiceUnavailableException } from "@nestjs/common";
import { clientIp } from "../common/client-ip";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";
import { SEARCH_INDEX, type ListingDocument, type SearchIndex } from "./search-index";

// Same shape as an item in GET /listings, so the storefront's listing card can show either.
const toSummary = (doc: ListingDocument, now: Date) => {
  const startsAt = new Date(doc.starts_at * 1000);
  const endsAt = new Date(doc.ends_at * 1000);
  return {
    id: doc.id,
    title: doc.title,
    startingPriceCents: doc.price_cents,
    bidCount: doc.bid_count,
    // The indexed price is the current bid once there are bids, so a card can say "current bid" instead of "starting".
    currentBidCents: doc.bid_count > 0 ? doc.price_cents : null,
    finalChance: doc.final_chance ?? false,
    phase: listingPhase({ status: "PUBLISHED", startsAt, endsAt }, now),
    startsAt,
    endsAt,
    images: doc.cover_url ? [{ id: `${doc.id}-cover`, url: doc.cover_url }] : [],
  };
};

@Controller()
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    @Inject(SEARCH_INDEX) private readonly search: SearchIndex,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  // Search is public, so it is limited per visitor address: the signed address the web server passes on, or the caller's own when
  // someone calls the API directly. Counted before any work is done.
  private async limit(req: Parameters<typeof clientIp>[0], name: string, rule: { limit: number; windowSeconds: number }) {
    const ip = clientIp(req);
    if (ip && !(await this.limiter.allow(`rl:${name}:${ip}`, rule.limit, rule.windowSeconds))) {
      throw new HttpException({ code: "RATE_LIMITED", message: "You are searching too fast. Wait a moment and try again." }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  @Get("search")
  async find(@Req() req: Parameters<typeof clientIp>[0], @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery) {
    await this.limit(req, "search", SEARCH_RATE_LIMIT);
    const now = new Date();
    try {
      const { documents, total } = await this.search.search({
        ...query,
        sort: resolveSearchSort(query),
        endingSoon: query.endingSoon ?? false,
        now,
      });
      return { items: documents.map((doc) => toSummary(doc, now)), total, page: query.page, pageSize: query.pageSize };
    } catch (error) {
      this.logger.error(`Search failed: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException("Search is unavailable right now");
    }
  }

  // Titles of live and upcoming listings that match the text so far, best match first, each title once. It asks the same
  // index as the search page, so Typesense gives typo tolerance and the Postgres fallback gives partial words.
  @Get("search/suggest")
  async suggest(@Req() req: Parameters<typeof clientIp>[0], @Query(new ZodValidationPipe(suggestQuerySchema)) query: { q: string }) {
    await this.limit(req, "suggest", SUGGEST_RATE_LIMIT);
    try {
      const { documents } = await this.search.search({
        q: query.q,
        sort: "relevance",
        endingSoon: false,
        page: 1,
        // Several listings share a title, so ask for more than are shown.
        pageSize: SUGGESTION_COUNT * 4,
        now: new Date(),
      });
      const seen = new Set<string>();
      const suggestions: string[] = [];
      for (const { title } of documents) {
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push(title);
        if (suggestions.length === SUGGESTION_COUNT) break;
      }
      return { suggestions };
    } catch (error) {
      this.logger.error(`Suggestions failed: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException("Search is unavailable right now");
    }
  }
}

import { ENDING_SOON_HOURS, extensionCeiling, isFinalChance, type SearchSort } from "@auction/shared";
import { Prisma as Sql } from "@auction/db";
import type { Prisma } from "../db/db.module";
import { parseTerms, typosAllowed, type SearchTerm } from "./search-terms";
import type { ListingDocument, SearchIndex, SearchParams } from "./search-index";

const MAX_WORDS = 8;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

interface Row {
  id: string;
  title: string;
  description: string;
  categorySlug: string;
  condition: string;
  priceCents: number;
  bidCount: number;
  startsAt: Date;
  endsAt: Date;
  publishedAt: Date;
  durationDays: number;
  sellerUsername: string;
  coverUrl: string | null;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Search straight from Postgres, for environments without Typesense. The data is already in the database, so there is
// nothing to keep in step: every write method does nothing. It matches like Typesense does: whole words in the title or
// description (the last word typed may be only the start of one), words with a typo (1 from 4 letters, 2 from 6, using
// Postgres's fuzzystrmatch), synonyms from synonyms.ts, and, when nothing matches every word, the listings that match the
// most of them.
export class PostgresSearchIndex implements SearchIndex {
  constructor(private readonly prisma: Prisma) {}

  async ensureReady() {}
  async upsert() {}
  async update() {}
  async remove() {}
  async removeEnded() {}
  async replaceAll() {}

  async search(params: SearchParams) {
    const terms = parseTerms(params.q).slice(0, MAX_WORDS);
    const first = await this.run(params, terms, terms.length);
    if (first.total > 0 || terms.length < 2) return first;
    // Like Typesense, when no listing has every word, fall back to the ones that have the most of them.
    const best = await this.mostTermsMatched(params, terms);
    return best >= 1 ? this.run(params, terms, best) : first;
  }

  private baseWhere(params: SearchParams) {
    const price = Sql.sql`COALESCE(l."currentBidCents", l."startingPriceCents")`;
    const where = [Sql.sql`l."status" = 'PUBLISHED'`, Sql.sql`l."endsAt" > ${params.now}`];
    if (params.category) where.push(Sql.sql`c."slug" = ${params.category}`);
    if (params.condition) where.push(Sql.sql`l."condition"::text = ANY(${params.condition}::text[])`);
    if (params.minPriceCents !== undefined) where.push(Sql.sql`${price} >= ${params.minPriceCents}`);
    if (params.maxPriceCents !== undefined) where.push(Sql.sql`${price} <= ${params.maxPriceCents}`);
    // "Ending latest" lists only live auctions: an upcoming one has not started, so it has no end worth ranking yet.
    if (params.endingSoon || params.sort === "endingLatest") where.push(Sql.sql`l."startsAt" <= ${params.now}`);
    if (params.endingSoon) where.push(Sql.sql`l."endsAt" <= ${new Date(params.now.getTime() + ENDING_SOON_HOURS * 3600_000)}`);
    return where;
  }

  // True when the text has the word: as a whole word (or, for the last word typed, the start of one), as a synonym, or
  // within the allowed number of typos of one of its words.
  private termMatches(column: ReturnType<typeof Sql.sql>, term: SearchTerm, isLast: boolean) {
    const typed = isLast ? escapeRegex(term.text) : `${escapeRegex(term.text)}\\M`;
    const alternatives = term.alternatives.map((alt) => `${escapeRegex(alt)}\\M`);
    const pattern = `\\m(?:${[typed, ...alternatives].join("|")})`;
    const parts = [Sql.sql`${column} ~* ${pattern}`];
    const typos = term.text.includes(" ") ? 0 : typosAllowed(term.text.length);
    if (typos > 0) {
      const prefix = isLast ? Sql.sql` OR levenshtein(left(w.word, ${term.text.length}::int), ${term.text}::text) <= ${typos}::int` : Sql.empty;
      parts.push(Sql.sql`EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(${column}), '[^[:alnum:]]+') AS w(word)
        WHERE length(w.word) BETWEEN 1 AND 100 AND (levenshtein(w.word, ${term.text}::text) <= ${typos}::int${prefix}))`);
    }
    return Sql.sql`(${Sql.join(parts, " OR ")})`;
  }

  private termInListing(term: SearchTerm, isLast: boolean) {
    return Sql.sql`(${this.termMatches(Sql.sql`l."title"`, term, isLast)} OR ${this.termMatches(Sql.sql`l."description"`, term, isLast)})`;
  }

  private matchedCount(terms: SearchTerm[]) {
    return Sql.join(terms.map((term, i) => Sql.sql`(CASE WHEN ${this.termInListing(term, i === terms.length - 1)} THEN 1 ELSE 0 END)`), " + ");
  }

  private async mostTermsMatched(params: SearchParams, terms: SearchTerm[]) {
    const rows = await this.prisma.$queryRaw<{ best: number }[]>`
      SELECT COALESCE(MAX(m."matched"), 0)::int AS "best" FROM (
        SELECT (${this.matchedCount(terms)}) AS "matched"
        FROM "Listing" l JOIN "Category" c ON c."id" = l."categoryId" JOIN "User" u ON u."id" = l."sellerId"
        WHERE ${Sql.join(this.baseWhere(params), " AND ")}) m`;
    return rows[0]?.best ?? 0;
  }

  // `required` is how many of the terms a listing must match: all of them, or fewer when falling back.
  private async run(params: SearchParams, terms: SearchTerm[], required: number) {
    const price = Sql.sql`COALESCE(l."currentBidCents", l."startingPriceCents")`;
    const where = this.baseWhere(params);
    if (terms.length > 0) {
      where.push(required >= terms.length ? Sql.join(terms.map((term, i) => this.termInListing(term, i === terms.length - 1)), " AND ") : Sql.sql`(${this.matchedCount(terms)}) >= ${required}::int`);
    }
    const whereSql = Sql.join(where, " AND ");

    // Best match: listings with more of the words in the title come first (and, in a fallback, more of the words overall).
    const titleHits = terms.length > 0 ? Sql.join(terms.map((term, i) => Sql.sql`(CASE WHEN ${this.termMatches(Sql.sql`l."title"`, term, i === terms.length - 1)} THEN 1 ELSE 0 END)`), " + ") : Sql.sql`0`;
    const matched = required < terms.length ? Sql.sql`(${this.matchedCount(terms)}) DESC, ` : Sql.empty;
    const orderBy: Record<SearchSort, ReturnType<typeof Sql.sql>> = {
      relevance: Sql.sql`${matched}(${titleHits}) DESC, l."endsAt" ASC`,
      endingSoon: Sql.sql`l."endsAt" ASC`,
      endingLatest: Sql.sql`l."endsAt" DESC`,
      newest: Sql.sql`l."publishedAt" DESC`,
      mostBids: Sql.sql`l."bidCount" DESC, l."endsAt" ASC`,
      fewestBids: Sql.sql`l."bidCount" ASC, l."endsAt" ASC`,
      priceAsc: Sql.sql`${price} ASC`,
      priceDesc: Sql.sql`${price} DESC`,
    };

    const from = Sql.sql`FROM "Listing" l JOIN "Category" c ON c."id" = l."categoryId" JOIN "User" u ON u."id" = l."sellerId" WHERE ${whereSql}`;
    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT l."id", l."title", l."description", c."slug" AS "categorySlug", l."condition"::text AS "condition",
               ${price}::int AS "priceCents", l."bidCount", l."startsAt", l."endsAt", l."publishedAt", l."durationDays",
               u."username" AS "sellerUsername",
               (SELECT i."url" FROM "ListingImage" i WHERE i."listingId" = l."id" ORDER BY i."position" ASC LIMIT 1) AS "coverUrl"
        ${from}
        ORDER BY ${orderBy[params.sort]}, l."id" ASC
        LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" ${from}`,
    ]);

    const documents = rows.map(
      (row): ListingDocument => ({
        id: row.id,
        title: row.title,
        description: row.description,
        category_slug: row.categorySlug,
        condition: row.condition,
        price_cents: row.priceCents,
        bid_count: row.bidCount,
        final_chance: isFinalChance(row.endsAt, extensionCeiling(row.startsAt, row.durationDays)),
        starts_at: seconds(row.startsAt),
        ends_at: seconds(row.endsAt),
        published_at: seconds(row.publishedAt),
        seller_username: row.sellerUsername,
        cover_url: row.coverUrl ?? undefined,
      }),
    );
    return { documents, total: counted[0]?.total ?? 0 };
  }
}

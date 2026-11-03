import { ENDING_SOON_HOURS, extensionCeiling, isFinalChance, type SearchSort } from "@auction/shared";
import { Prisma as Sql } from "@auction/db";
import type { Prisma } from "../db/db.module";
import { normalizeQuery } from "./typesense-search-index";
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

// Search straight from Postgres, for environments without Typesense. The data is already in the database, so there is
// nothing to keep in step: every write method does nothing. It matches whole or partial words in the title and
// description but, unlike Typesense, has no typo tolerance or synonyms.
export class PostgresSearchIndex implements SearchIndex {
  constructor(private readonly prisma: Prisma) {}

  async ensureReady() {}
  async upsert() {}
  async update() {}
  async remove() {}
  async removeEnded() {}
  async replaceAll() {}

  async search(params: SearchParams) {
    const price = Sql.sql`COALESCE(l."currentBidCents", l."startingPriceCents")`;
    const words = normalizeQuery(params.q)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, MAX_WORDS)
      .map((word) => `%${word.replace(/[\\%_]/g, "\\$&")}%`);

    const where = [Sql.sql`l."status" = 'PUBLISHED'`, Sql.sql`l."endsAt" > ${params.now}`];
    if (params.category) where.push(Sql.sql`c."slug" = ${params.category}`);
    if (params.condition) where.push(Sql.sql`l."condition" = ${params.condition}::"ListingCondition"`);
    if (params.minPriceCents !== undefined) where.push(Sql.sql`${price} >= ${params.minPriceCents}`);
    if (params.maxPriceCents !== undefined) where.push(Sql.sql`${price} <= ${params.maxPriceCents}`);
    if (params.endingSoon) {
      where.push(Sql.sql`l."startsAt" <= ${params.now}`, Sql.sql`l."endsAt" <= ${new Date(params.now.getTime() + ENDING_SOON_HOURS * 3600_000)}`);
    }
    for (const word of words) where.push(Sql.sql`(l."title" ILIKE ${word} OR l."description" ILIKE ${word})`);
    const whereSql = Sql.join(where, " AND ");

    // Best match: listings with more of the words in the title come first.
    const titleHits = words.length > 0 ? Sql.join(words.map((word) => Sql.sql`(CASE WHEN l."title" ILIKE ${word} THEN 1 ELSE 0 END)`), " + ") : Sql.sql`0`;
    const orderBy: Record<SearchSort, ReturnType<typeof Sql.sql>> = {
      relevance: Sql.sql`(${titleHits}) DESC, l."endsAt" ASC`,
      endingSoon: Sql.sql`l."endsAt" ASC`,
      newest: Sql.sql`l."publishedAt" DESC`,
      mostBids: Sql.sql`l."bidCount" DESC, l."endsAt" ASC`,
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

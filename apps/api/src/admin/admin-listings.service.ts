import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { listingPhase, parseCountFilter, parsePriceFilter } from "@auction/shared";
import { AuctionCloseService } from "../auctions/auction-close.service";
import { PRISMA, type Prisma } from "../db/db.module";
import type { RemovedNotice } from "@auction/shared";
import { notificationKey } from "../notifications/notification-keys";
import { Notify } from "../realtime/notify.service";
import { SEARCH_INDEX, type SearchIndex } from "../search/search-index";

export interface ListingListQuery {
  q?: string;
  sellerId?: string;
  phase?: "upcoming" | "live" | "ended" | "removed";
  // Sort by one column (newest first without one) and narrow by the text typed under a column header.
  sort?: "title" | "seller" | "price" | "bids" | "ends";
  dir?: "asc" | "desc";
  f_title?: string;
  f_seller?: string;
  f_state?: "upcoming" | "live" | "ended" | "removed";
  // An amount or a range in euros, and a count or a range of bids ("10-50", "3", "2-"), read by `parsePriceFilter` and `parseCountFilter`.
  f_price?: string;
  f_bids?: string;
  page: number;
  limit: number;
}

const phaseWhere = (phase: ListingListQuery["phase"], now: Date) =>
  phase === "upcoming" ? { startsAt: { gt: now } }
  : phase === "live" ? { startsAt: { lte: now }, endsAt: { gt: now } }
  : phase === "ended" ? { endsAt: { lte: now } }
  : phase === "removed" ? { removedAt: { not: null } }
  : {};

// The price shown is the current bid, or the starting price while there is none; Prisma cannot sort by that, so a sort by price is
// done in SQL over the ids the other conditions found.
const listingOrder = (sort: ListingListQuery["sort"], d: "asc" | "desc") =>
  sort === "title" ? { title: d }
  : sort === "seller" ? { seller: { username: d } }
  : sort === "bids" ? { bidCount: d }
  : sort === "ends" ? { endsAt: d }
  : { publishedAt: "desc" as const };

// An admin taking a listing down. A removal ends the auction at once with no sale, whatever the bids and the reserve (see
// AuctionCloseService.closeRemoved): every bidder is told there is no winner and nobody has to pay. The listing then shows as
// ended, the seller cannot list it again, and an auction whose end time has passed (it may be a sale) cannot be removed this way.
@Injectable()
export class AdminListingsService {
  private readonly log = new Logger(AdminListingsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(SEARCH_INDEX) private readonly search: SearchIndex,
    private readonly closer: AuctionCloseService,
    private readonly notify: Notify,
  ) {}

  // Published listings, newest first. `q` matches the id, the title or part of the seller's username; `sellerId` is exactly one
  // seller. `total` is how many match, whatever the limit.
  async list({ q, sellerId, phase, sort, dir = "asc", f_title, f_seller, f_state, f_price, f_bids, page, limit }: ListingListQuery) {
    const term = q?.trim();
    const now = new Date();
    const price = f_price ? parsePriceFilter(f_price) : null;
    const bids = f_bids ? parseCountFilter(f_bids) : null;
    // Each condition is its own entry: the page's state filter and the column's can both be given, and each is an object with the same keys.
    const where = {
      status: "PUBLISHED" as const,
      AND: [
        phaseWhere(phase, now),
        phaseWhere(f_state, now),
        ...(price
          ? [{ OR: [{ currentBidCents: { ...(price.min !== null ? { gte: price.min } : {}), ...(price.max !== null ? { lte: price.max } : {}) } }, { currentBidCents: null, startingPriceCents: { ...(price.min !== null ? { gte: price.min } : {}), ...(price.max !== null ? { lte: price.max } : {}) } }] }]
          : []),
        ...(bids ? [{ bidCount: { ...(bids.min !== null ? { gte: bids.min } : {}), ...(bids.max !== null ? { lte: bids.max } : {}) } }] : []),
      ],
      ...(sellerId ? { sellerId } : {}),
      ...(f_title ? { title: { contains: f_title, mode: "insensitive" as const } } : {}),
      ...(f_seller ? { seller: { username: { contains: f_seller, mode: "insensitive" as const } } } : {}),
      ...(term ? { OR: [{ id: term }, { title: { contains: term, mode: "insensitive" as const } }, { seller: { username: { contains: term, mode: "insensitive" as const } } }] } : {}),
    };
    const select = { id: true, title: true, status: true, startsAt: true, endsAt: true, bidCount: true, currentBidCents: true, startingPriceCents: true, outcome: true, removedAt: true, seller: { select: { id: true, username: true } } } as const;
    let rows;
    let total;
    if (sort === "price") {
      const ids = (await this.prisma.listing.findMany({ where, select: { id: true } })).map((l) => l.id);
      const ordered = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Listing" WHERE "id" = ANY(${ids})
        ORDER BY COALESCE("currentBidCents", "startingPriceCents") * ${dir === "desc" ? -1 : 1}::int, "id" ASC`;
      const pageIds = ordered.slice((page - 1) * limit, page * limit).map((r) => r.id);
      const found = new Map((await this.prisma.listing.findMany({ where: { id: { in: pageIds } }, select })).map((l) => [l.id, l]));
      rows = pageIds.flatMap((id) => (found.has(id) ? [found.get(id)!] : []));
      total = ordered.length;
    } else {
      [rows, total] = await Promise.all([
        this.prisma.listing.findMany({ where, orderBy: [listingOrder(sort, dir), { id: "asc" }], skip: (page - 1) * limit, take: limit, select }),
        this.prisma.listing.count({ where }),
      ]);
    }
    return {
      total,
      listings: rows.map((l) => ({
        id: l.id,
        title: l.title,
        phase: listingPhase(l, now),
        seller: l.seller,
        bidCount: l.bidCount,
        priceCents: l.currentBidCents ?? l.startingPriceCents,
        endsAt: l.endsAt?.toISOString() ?? null,
        outcome: l.outcome,
        removed: l.removedAt !== null,
      })),
    };
  }

  async get(id: string) {
    const l = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        id: true, title: true, description: true, status: true, startsAt: true, endsAt: true, closedAt: true, outcome: true, bidCount: true, currentBidCents: true, startingPriceCents: true,
        reservePriceCents: true, removedAt: true, removedById: true, removalReason: true,
        seller: { select: { id: true, username: true } },
        highBidder: { select: { id: true, username: true } },
        images: { select: { url: true }, orderBy: { position: "asc" } },
      },
    });
    if (!l) throw new NotFoundException();
    const removedBy = l.removedById ? await this.prisma.user.findUnique({ where: { id: l.removedById }, select: { id: true, username: true } }) : null;
    return {
      id: l.id,
      title: l.title,
      description: l.description,
      status: l.status,
      phase: listingPhase(l, new Date()),
      seller: l.seller,
      bidCount: l.bidCount,
      currentBidCents: l.currentBidCents,
      startingPriceCents: l.startingPriceCents,
      reservePriceCents: l.reservePriceCents,
      highBidder: l.highBidder,
      images: l.images.map((i) => i.url),
      startsAt: l.startsAt?.toISOString() ?? null,
      endsAt: l.endsAt?.toISOString() ?? null,
      closedAt: l.closedAt?.toISOString() ?? null,
      outcome: l.outcome,
      removal: l.removedAt ? { at: l.removedAt.toISOString(), reason: l.removalReason ?? "", by: removedBy ?? (l.removedById ? { id: l.removedById, username: null } : null) } : null,
    };
  }

  async remove(adminId: string, id: string, reason: string) {
    const done = await this.closer.closeRemoved(id, { adminId, reason });
    if (!done) {
      const l = await this.prisma.listing.findUnique({ where: { id }, select: { status: true, closedAt: true, endsAt: true } });
      if (!l) throw new NotFoundException();
      if (l.status !== "PUBLISHED") throw new ConflictException({ code: "NOT_PUBLISHED", message: "Only a published listing can be removed" });
      if (!l.closedAt && l.endsAt && l.endsAt.getTime() <= Date.now() + 1000) {
        throw new ConflictException({ code: "AUCTION_ENDED", message: "This auction has just ended and is being closed, so it cannot be removed. Check it again in a moment." });
      }
      throw new ConflictException({ code: "ALREADY_CLOSED", message: "This auction has already ended" });
    }
    await this.prisma.adminAction.create({ data: { adminId, action: "REMOVE_LISTING", targetId: id, reason } });
    try {
      await this.search.remove(id);
    } catch (error) {
      this.log.error(`Search removal failed for listing ${id}: ${error instanceof Error ? error.message : error}`);
    }
    await this.tellSeller(id, reason);
    await this.tellBidders(id, reason);
    return this.get(id);
  }

  // A bell entry for everyone who bid on it (their email is queued by the close itself). Best effort: the removal has happened either way.
  private async tellBidders(listingId: string, reason: string) {
    try {
      const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, sellerId: true } });
      if (!listing) return;
      const bids = await this.prisma.bid.findMany({ where: { listingId }, select: { bidderId: true }, distinct: ["bidderId"] });
      const bidders = bids.map((b) => b.bidderId).filter((id) => id !== listing.sellerId);
      if (bidders.length === 0) return;
      const notice: RemovedNotice = { reason, bidder: true };
      await this.notify.saveAndAnnounce(bidders, { type: "LISTING_REMOVED", key: notificationKey.removed(listingId), listingId, title: listing.title, data: notice });
    } catch (error) {
      this.log.error(`Could not notify the bidders of listing ${listingId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // A bell entry for the seller (the email is queued by the close itself). Best effort: the removal has happened either way.
  private async tellSeller(listingId: string, reason: string) {
    try {
      const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { title: true, sellerId: true } });
      if (!listing) return;
      const notice: RemovedNotice = { reason };
      await this.notify.saveAndAnnounce([listing.sellerId], { type: "LISTING_REMOVED", key: notificationKey.removed(listingId), listingId, title: listing.title, data: notice });
    } catch (error) {
      this.log.error(`Could not notify the seller of listing ${listingId}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

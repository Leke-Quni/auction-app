import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { listingPhase } from "@auction/shared";
import { AuctionCloseService } from "../auctions/auction-close.service";
import { PRISMA, type Prisma } from "../db/db.module";
import { SOCKET_EVENTS, type RemovedNotice, type UnreadEvent } from "@auction/shared";
import { SavedNotificationsService } from "../notifications/saved-notifications.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SEARCH_INDEX, type SearchIndex } from "../search/search-index";

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
    private readonly saved: SavedNotificationsService,
    private readonly gateway: RealtimeGateway,
  ) {}

  // Published listings, newest first. `q` matches the id, the title or the seller's username.
  async list({ q, phase, limit }: { q?: string; phase?: "upcoming" | "live" | "ended" | "removed"; limit: number }) {
    const term = q?.trim();
    const now = new Date();
    const phaseWhere =
      phase === "upcoming" ? { startsAt: { gt: now } }
      : phase === "live" ? { startsAt: { lte: now }, endsAt: { gt: now } }
      : phase === "ended" ? { endsAt: { lte: now } }
      : phase === "removed" ? { removedAt: { not: null } }
      : {};
    const rows = await this.prisma.listing.findMany({
      where: {
        status: "PUBLISHED",
        ...phaseWhere,
        ...(term ? { OR: [{ id: term }, { title: { contains: term, mode: "insensitive" } }, { seller: { username: { contains: term, mode: "insensitive" } } }] } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, title: true, status: true, startsAt: true, endsAt: true, bidCount: true, currentBidCents: true, startingPriceCents: true, outcome: true, removedAt: true, seller: { select: { id: true, username: true } } },
    });
    return {
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
      const unread = await this.saved.save(bidders, { type: "LISTING_REMOVED", key: `removed:${listingId}`, listingId, title: listing.title, data: notice });
      for (const [userId, unreadCount] of unread) this.gateway.emitToUsers([userId], SOCKET_EVENTS.unread, { unreadCount } satisfies UnreadEvent);
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
      const unread = await this.saved.save([listing.sellerId], { type: "LISTING_REMOVED", key: `removed:${listingId}`, listingId, title: listing.title, data: notice });
      for (const [userId, unreadCount] of unread) this.gateway.emitToUsers([userId], SOCKET_EVENTS.unread, { unreadCount } satisfies UnreadEvent);
    } catch (error) {
      this.log.error(`Could not notify the seller of listing ${listingId}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

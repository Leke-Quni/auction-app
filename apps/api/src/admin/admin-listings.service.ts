import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { listingPhase } from "@auction/shared";
import { AuctionCloseService } from "../auctions/auction-close.service";
import { PRISMA, type Prisma } from "../db/db.module";
import { SEARCH_INDEX, type SearchIndex } from "../search/search-index";

// An admin taking a listing down. A removal ends the auction at once with no sale, whatever the bids and the reserve (see
// AuctionCloseService.closeRemoved): every bidder is told there is no winner and nobody has to pay. The listing then shows as
// ended, the seller cannot list it again, and a sold auction (it has an order) cannot be removed this way.
@Injectable()
export class AdminListingsService {
  private readonly log = new Logger(AdminListingsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(SEARCH_INDEX) private readonly search: SearchIndex,
    private readonly closer: AuctionCloseService,
  ) {}

  async get(id: string) {
    const l = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        id: true, title: true, status: true, startsAt: true, endsAt: true, closedAt: true, outcome: true, bidCount: true, currentBidCents: true, startingPriceCents: true,
        reservePriceCents: true, removedAt: true, removedById: true, removalReason: true,
        seller: { select: { id: true, username: true } },
        highBidder: { select: { id: true, username: true } },
      },
    });
    if (!l) throw new NotFoundException();
    const removedBy = l.removedById ? await this.prisma.user.findUnique({ where: { id: l.removedById }, select: { id: true, username: true } }) : null;
    return {
      id: l.id,
      title: l.title,
      status: l.status,
      phase: listingPhase(l, new Date()),
      seller: l.seller,
      bidCount: l.bidCount,
      currentBidCents: l.currentBidCents,
      startingPriceCents: l.startingPriceCents,
      reservePriceCents: l.reservePriceCents,
      highBidder: l.highBidder,
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
      const l = await this.prisma.listing.findUnique({ where: { id }, select: { status: true, closedAt: true } });
      if (!l) throw new NotFoundException();
      if (l.status !== "PUBLISHED") throw new ConflictException({ code: "NOT_PUBLISHED", message: "Only a published listing can be removed" });
      throw new ConflictException({ code: "ALREADY_CLOSED", message: "This auction has already ended" });
    }
    try {
      await this.search.remove(id);
    } catch (error) {
      this.log.error(`Search removal failed for listing ${id}: ${error instanceof Error ? error.message : error}`);
    }
    return this.get(id);
  }
}

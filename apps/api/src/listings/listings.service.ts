import {
  createListingSchema,
  extensionCeiling,
  isFinalChance,
  listingPhase,
  MAX_STRIKES,
  minimumNextBidCents,
  type CreateListingInput,
  type ListingImageInput,
  type PickupAddress,
  type PublishListingInput,
  type UpdateListingInput,
} from "@auction/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Prisma as PrismaTypes } from "@auction/db";
import { JOB_SCHEDULER, type JobScheduler } from "../jobs/job-scheduler";
import { PRISMA, type Prisma } from "../db/db.module";
import { SEARCH_INDEX, type ListingDocument, type SearchIndex } from "../search/search-index";
import { isSellerImage } from "./seller-image";

const ENDING_SOON_MS = 24 * 60 * 60 * 1000;
const SEARCH_SWEEP_MS = 5 * 60 * 1000;

const listingInclude = {
  category: true,
  seller: { select: { id: true, username: true } },
  highBidder: { select: { id: true, username: true } },
  winner: { select: { id: true, username: true } },
  images: { orderBy: { position: "asc" } },
} satisfies PrismaTypes.ListingInclude;

type ListingRow = PrismaTypes.ListingGetPayload<{ include: typeof listingInclude }>;

// True once a published auction's end has reached its ceiling and cannot move again.
const isFinal = (l: ListingRow) => (l.startsAt && l.endsAt ? isFinalChance(l.endsAt, extensionCeiling(l.startsAt, l.durationDays)) : false);

const REMOVED_TITLE = "Removed by moderation";

// `forSeller` adds the pickup address, which only the seller may see: it is the seller's home or business address.
const toDto = (l: ListingRow, now = new Date(), forSeller = false) => ({
  ...(forSeller ? { pickupAddress: l.pickupAddress } : {}),
  id: l.id,
  // A listing a moderator removed shows its seller but none of its words or photos to anyone but the seller.
  title: l.removedAt && !forSeller ? REMOVED_TITLE : l.title,
  description: l.removedAt && !forSeller ? "" : l.description,
  category: { id: l.category.id, slug: l.category.slug, name: l.category.name },
  condition: l.condition,
  startingPriceCents: l.startingPriceCents,
  reservePriceCents: l.reservePriceCents,
  durationDays: l.durationDays,
  status: l.status,
  phase: listingPhase(l, now),
  // The server's clock when this was sent, so a countdown can follow it instead of the viewer's clock.
  serverTime: now.toISOString(),
  extensionCount: l.extensionCount,
  finalChance: isFinal(l),
  currentBidCents: l.currentBidCents,
  bidCount: l.bidCount,
  minimumNextBidCents: minimumNextBidCents(l),
  highBidder: l.highBidder,
  // Null until the close job has run for an ended auction.
  closedAt: l.closedAt,
  outcome: l.outcome,
  // True when a moderator took the auction down; the reason is for the seller only.
  removed: l.removedAt !== null,
  ...(forSeller ? { removalReason: l.removalReason } : {}),
  winner: l.winner,
  finalPriceCents: l.finalPriceCents,
  startsAt: l.startsAt,
  endsAt: l.endsAt,
  publishedAt: l.publishedAt,
  seller: l.seller,
  images: l.removedAt && !forSeller ? [] : l.images.map((i) => ({ id: i.id, url: i.url, position: i.position })),
});

// Only live and upcoming published listings are searchable.
const toDocument = (l: ListingRow, now = new Date()): ListingDocument | null => {
  if (l.status !== "PUBLISHED" || !l.startsAt || !l.endsAt || !l.publishedAt || l.endsAt <= now) return null;
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    category_slug: l.category.slug,
    condition: l.condition,
    price_cents: l.currentBidCents ?? l.startingPriceCents,
    bid_count: l.bidCount,
    final_chance: isFinal(l),
    starts_at: Math.floor(l.startsAt.getTime() / 1000),
    ends_at: Math.floor(l.endsAt.getTime() / 1000),
    published_at: Math.floor(l.publishedAt.getTime() / 1000),
    seller_username: l.seller.username,
    cover_url: l.images[0]?.url,
  };
};

@Injectable()
export class ListingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ListingsService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(SEARCH_INDEX) private readonly search: SearchIndex,
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobScheduler,
  ) {}

  async onModuleInit() {
    await this.sweepSearch();
    this.sweepTimer = setInterval(() => void this.sweepSearch(), SEARCH_SWEEP_MS);
    this.sweepTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweepTimer);
  }

  // Rebuilds the search index from Postgres. Run it to repair the index after downtime or a schema change.
  async reindexSearch() {
    const rows = await this.prisma.listing.findMany({
      where: { status: "PUBLISHED", endsAt: { gt: new Date() } },
      include: listingInclude,
    });
    const docs = rows.map((l) => toDocument(l)).filter((doc): doc is ListingDocument => doc !== null);
    await this.search.replaceAll(docs);
    return docs.length;
  }

  // Ended auctions drop out of the index. Searches also filter by end time, so a missed sweep shows nothing stale.
  private async sweepSearch() {
    try {
      await this.search.removeEnded(new Date());
    } catch (error) {
      this.logger.error(`Search sweep failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  // The listing is already saved, so a search outage must not fail the request; the next sweep or reindex repairs it.
  private async syncSearch(listing: ListingRow) {
    if (listing.status !== "PUBLISHED") return;
    try {
      const doc = toDocument(listing);
      if (doc) await this.search.upsert(doc);
      else await this.search.remove(listing.id);
    } catch (error) {
      this.logger.error(`Search sync failed for listing ${listing.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  categories() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, slug: true, name: true } });
  }

  async create(sellerId: string, input: CreateListingInput) {
    await this.requireCategory(input.categoryId);
    const listing = await this.prisma.listing.create({ data: { ...input, sellerId }, include: listingInclude });
    return toDto(listing, new Date(), true);
  }

  async findOne(id: string, viewerId?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id }, include: listingInclude });
    // A draft is private: anyone but the seller gets the same answer as for a listing that does not exist.
    if (!listing || (listing.status === "DRAFT" && listing.sellerId !== viewerId)) throw new NotFoundException();
    const dto = toDto(listing, new Date(), listing.sellerId === viewerId);
    // How many watch it, and, for a signed-in viewer, whether they are blocked from bidding (two strikes), so the page says
    // so instead of offering a bid box, and whether they are watching it. One round trip, not one after another.
    const [watcherCount, sellerStats, strikes, watching] = await Promise.all([
      this.prisma.watch.count({ where: { listingId: id } }),
      this.prisma.rating.aggregate({ where: { sellerId: listing.sellerId }, _avg: { stars: true }, _count: true }),
      viewerId ? this.prisma.strike.count({ where: { userId: viewerId } }) : 0,
      viewerId ? this.prisma.watch.count({ where: { userId: viewerId, listingId: id } }) : 0,
    ]);
    // How buyers have rated the seller: the average to one decimal (null until someone has) and how many ratings.
    const sellerRating = { average: sellerStats._avg.stars === null ? null : Math.round(sellerStats._avg.stars * 10) / 10, count: sellerStats._count };
    if (!viewerId) return { ...dto, watcherCount, sellerRating };
    return { ...dto, watcherCount, sellerRating, viewerBlocked: strikes >= MAX_STRIKES, watching: watching > 0 };
  }

  async list(page: number, pageSize: number, section?: "endingSoon" | "upcoming") {
    const now = new Date();
    const published = { status: "PUBLISHED" as const, endsAt: { gt: now } };
    const where =
      section === "upcoming"
        ? { ...published, startsAt: { gt: now } }
        : section === "endingSoon"
          ? { status: "PUBLISHED" as const, startsAt: { lte: now }, endsAt: { gt: now, lte: new Date(now.getTime() + ENDING_SOON_MS) } }
          : published;
    const orderBy =
      section === "upcoming"
        ? [{ startsAt: "asc" as const }, { id: "asc" as const }]
        : section === "endingSoon"
          ? [{ endsAt: "asc" as const }, { id: "asc" as const }]
          : [{ publishedAt: "desc" as const }, { id: "desc" as const }];
    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: items.map((l) => toDto(l, now)), total, page, pageSize };
  }

  async mine(sellerId: string) {
    const listings = await this.prisma.listing.findMany({
      where: { sellerId },
      include: listingInclude,
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    return listings.map((l) => toDto(l, now, true));
  }

  async update(sellerId: string, id: string, input: UpdateListingInput) {
    const listing = await this.getOwned(sellerId, id);
    this.refuseIfModeratorRemoved(listing);
    this.refuseIfEnded(listing);

    if (listing.status === "PUBLISHED") {
      const locked = Object.keys(input).filter((k) => k !== "description");
      if (locked.length > 0) {
        throw new BadRequestException(`Only the description can change after publishing (not ${locked.join(", ")})`);
      }
    } else {
      // Drafts accept any subset; check the combined result (for example reserve against starting price).
      const merged = createListingSchema.safeParse({
        title: listing.title,
        description: listing.description,
        categoryId: listing.categoryId,
        condition: listing.condition,
        startingPriceCents: listing.startingPriceCents,
        reservePriceCents: listing.reservePriceCents,
        durationDays: listing.durationDays,
        pickupAddress: listing.pickupAddress ?? undefined,
        ...input,
      });
      if (!merged.success) throw new BadRequestException(merged.error.flatten());
      if (input.categoryId) await this.requireCategory(input.categoryId);
    }

    // The draft or published state was read a moment ago. If the listing was published since, its terms (price, reserve,
    // duration) must not change under bidders, so a draft's details are written only while it is still a draft.
    const written = await this.prisma.listing.updateMany({
      where: listing.status === "DRAFT" ? { id, status: "DRAFT" } : { id },
      data: input,
    });
    if (written.count === 0) throw new ConflictException("This listing was just published, so those details can no longer change.");
    const updated = await this.prisma.listing.findUniqueOrThrow({ where: { id }, include: listingInclude });
    await this.syncSearch(updated);
    return toDto(updated, new Date(), true);
  }

  // Changes where the carrier collects, whatever the listing's state. Orders for the listing that are waiting for payment or paid
  // (the carrier has not collected yet; nothing records collection until slice 6) take the new address too.
  async setPickupAddress(sellerId: string, id: string, address: PickupAddress) {
    await this.getOwned(sellerId, id);
    const [, orders] = await this.prisma.$transaction([
      this.prisma.listing.update({ where: { id }, data: { pickupAddress: address } }),
      this.prisma.order.updateMany({ where: { listingId: id, status: { in: ["AWAITING_PAYMENT", "PAID"] } }, data: { pickupAddress: address } }),
    ]);
    const updated = await this.prisma.listing.findUniqueOrThrow({ where: { id }, include: listingInclude });
    return { ...toDto(updated, new Date(), true), ordersUpdated: orders.count };
  }

  async setImages(sellerId: string, id: string, images: ListingImageInput[]) {
    const listing = await this.getOwned(sellerId, id);
    this.refuseIfModeratorRemoved(listing);
    this.refuseIfEnded(listing);
    if (listing.status === "PUBLISHED" && images.length === 0) {
      throw new BadRequestException("A published listing needs at least one photo");
    }
    if (!images.every((image) => isSellerImage(image, sellerId))) {
      throw new BadRequestException("Photos must be uploaded through the site");
    }

    await this.prisma.$transaction([
      this.prisma.listingImage.deleteMany({ where: { listingId: id } }),
      this.prisma.listingImage.createMany({
        data: images.map((image, position) => ({ listingId: id, url: image.url, pathname: image.pathname, position })),
      }),
    ]);

    // The caller deletes these from Blob; this service has no Blob credentials.
    const kept = new Set(images.map((i) => i.url));
    const removedImageUrls = await this.unsharedUrls(listing.images.map((i) => i.url).filter((url) => !kept.has(url)));
    const updated = await this.prisma.listing.findUniqueOrThrow({ where: { id }, include: listingInclude });
    await this.syncSearch(updated);
    return { ...toDto(updated, new Date(), true), removedImageUrls };
  }

  async publish(sellerId: string, id: string, input: PublishListingInput) {
    const listing = await this.getOwned(sellerId, id);
    if (listing.status === "PUBLISHED") throw new ConflictException("This listing is already published");
    if (listing.images.length === 0) throw new BadRequestException("Add at least one photo before publishing");
    if (!listing.pickupAddress) throw new BadRequestException("Add a pickup address before publishing, so the carrier knows where to collect the item");

    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const endsAt = new Date(startsAt.getTime() + listing.durationDays * 86_400_000);
    const published = await this.prisma.listing.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date(), startsAt, endsAt },
      include: listingInclude,
    });
    await this.syncSearch(published);
    await this.scheduler.scheduleClose(published.id, endsAt);
    return toDto(published, new Date(), true);
  }

  async remove(sellerId: string, id: string) {
    const listing = await this.getOwned(sellerId, id);
    this.refuseIfEnded(listing);
    // One statement checks and deletes, so a bid that lands at the same moment cannot be deleted with the listing: the
    // bid transaction holds the row's lock, this waits for it, then sees the bid count and deletes nothing.
    // A listing a moderator removed stays as the record of why, so the seller cannot delete it either.
    const deleted = await this.prisma.listing.deleteMany({ where: { id, bidCount: 0, removedAt: null } });
    if (deleted.count === 0) {
      throw new ConflictException(listing.removedAt ? "A listing that a moderator removed cannot be deleted" : "A listing that has bids cannot be removed");
    }
    if (listing.status === "PUBLISHED") {
      try {
        await this.search.remove(id);
      } catch (error) {
        this.logger.error(`Search removal failed for listing ${id}: ${error instanceof Error ? error.message : error}`);
      }
    }
    return { removedImageUrls: await this.unsharedUrls(listing.images.map((i) => i.url)) };
  }

  // A seller whose auction ended without a sale can list the item again with one click: a new draft with the same details,
  // pickup address and photos (the old listing stays as the record). The draft is not published, so the seller can change
  // anything first, and while that draft exists, asking again returns it. Only a listing that closed with no bids or no sale qualifies, never one that sold or is still running.
  async relist(sellerId: string, id: string) {
    const old = await this.getOwned(sellerId, id);
    if (old.closedAt === null || (old.outcome !== "NO_SALE" && old.outcome !== "NO_BIDS")) {
      throw new ConflictException("Only an auction that ended without a sale can be listed again");
    }
    if (old.removedAt) throw new ConflictException("A listing that a moderator removed cannot be listed again");
    // Asking again (a double click, a second tab) returns the draft that is already there instead of making another. The
    // lock makes two calls at the same moment take turns.
    const draft = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`relist:${id}`}))`;
      const existing = await tx.listing.findFirst({ where: { relistedFromId: id, sellerId, status: "DRAFT" }, include: listingInclude });
      if (existing) return existing;
      return tx.listing.create({
        data: {
          sellerId,
          relistedFromId: id,
          title: old.title,
          description: old.description,
          categoryId: old.categoryId,
          condition: old.condition,
          startingPriceCents: old.startingPriceCents,
          reservePriceCents: old.reservePriceCents,
          durationDays: old.durationDays,
          images: { create: old.images.map((image) => ({ url: image.url, pathname: image.pathname, position: image.position })) },
        },
        include: listingInclude,
      });
    });
    return toDto(draft, new Date(), true);
  }

  // Photos a relisted draft shares with the listing it came from must stay in Blob when one of them lets go of a photo.
  private async unsharedUrls(urls: string[]) {
    if (urls.length === 0) return urls;
    const stillUsed = new Set((await this.prisma.listingImage.findMany({ where: { url: { in: urls } }, select: { url: true } })).map((i) => i.url));
    return urls.filter((url) => !stillUsed.has(url));
  }

  private async requireCategory(categoryId: string) {
    if (!(await this.prisma.category.findUnique({ where: { id: categoryId } }))) {
      throw new BadRequestException("Choose a valid category");
    }
  }

  // Someone else's draft looks like it does not exist; someone else's published listing is visible, so say 403.
  // A moderator took the listing down, so its words and photos cannot be changed to put the same content back.
  private refuseIfModeratorRemoved(listing: { removedAt: Date | null }) {
    if (listing.removedAt) throw new ConflictException("A listing that a moderator removed cannot be changed");
  }

  // An ended auction is closed by the system and stays as the record; the seller can only list it again (relist).
  private refuseIfEnded(listing: { status: string; closedAt: Date | null; endsAt: Date | null; removedAt: Date | null }) {
    // A moderator removal has its own message.
    if (listing.removedAt) return;
    if (listing.status === "PUBLISHED" && (listing.closedAt || (listing.endsAt && listing.endsAt <= new Date()))) {
      throw new ConflictException("An auction that has ended can no longer be changed or removed");
    }
  }

  private async getOwned(sellerId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id }, include: listingInclude });
    if (!listing) throw new NotFoundException();
    if (listing.sellerId !== sellerId) {
      throw listing.status === "PUBLISHED" ? new ForbiddenException() : new NotFoundException();
    }
    return listing;
  }
}

import {
  createListingSchema,
  listingPhase,
  type CreateListingInput,
  type ListingImageInput,
  type PublishListingInput,
  type UpdateListingInput,
} from "@auction/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma as PrismaTypes } from "@auction/db";
import { PRISMA, type Prisma } from "../db/db.module";
import { IMAGE_STORAGE, isSellerImage, type ImageStorage } from "./image-storage";

const listingInclude = {
  category: true,
  seller: { select: { id: true, username: true } },
  images: { orderBy: { position: "asc" } },
} satisfies PrismaTypes.ListingInclude;

type ListingRow = PrismaTypes.ListingGetPayload<{ include: typeof listingInclude }>;

const toDto = (l: ListingRow, now = new Date()) => ({
  id: l.id,
  title: l.title,
  description: l.description,
  category: { id: l.category.id, slug: l.category.slug, name: l.category.name },
  condition: l.condition,
  startingPriceCents: l.startingPriceCents,
  reservePriceCents: l.reservePriceCents,
  durationDays: l.durationDays,
  status: l.status,
  phase: listingPhase(l, now),
  startsAt: l.startsAt,
  endsAt: l.endsAt,
  publishedAt: l.publishedAt,
  seller: l.seller,
  images: l.images.map((i) => ({ id: i.id, url: i.url, position: i.position })),
});

@Injectable()
export class ListingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
  ) {}

  categories() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, slug: true, name: true } });
  }

  async create(sellerId: string, input: CreateListingInput) {
    await this.requireCategory(input.categoryId);
    const listing = await this.prisma.listing.create({ data: { ...input, sellerId }, include: listingInclude });
    return toDto(listing);
  }

  async findOne(id: string, viewerId?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id }, include: listingInclude });
    // A draft is private: anyone but the seller gets the same answer as for a listing that does not exist.
    if (!listing || (listing.status === "DRAFT" && listing.sellerId !== viewerId)) throw new NotFoundException();
    return toDto(listing);
  }

  async list(page: number, pageSize: number) {
    const where = { status: "PUBLISHED" as const, endsAt: { gt: new Date() } };
    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);
    const now = new Date();
    return { items: items.map((l) => toDto(l, now)), total, page, pageSize };
  }

  async mine(sellerId: string) {
    const listings = await this.prisma.listing.findMany({
      where: { sellerId },
      include: listingInclude,
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    return listings.map((l) => toDto(l, now));
  }

  async update(sellerId: string, id: string, input: UpdateListingInput) {
    const listing = await this.getOwned(sellerId, id);

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
        ...input,
      });
      if (!merged.success) throw new BadRequestException(merged.error.flatten());
      if (input.categoryId) await this.requireCategory(input.categoryId);
    }

    const updated = await this.prisma.listing.update({ where: { id }, data: input, include: listingInclude });
    return toDto(updated);
  }

  async setImages(sellerId: string, id: string, images: ListingImageInput[]) {
    const listing = await this.getOwned(sellerId, id);
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

    const kept = new Set(images.map((i) => i.url));
    await this.storage.delete(listing.images.map((i) => i.url).filter((url) => !kept.has(url)));
    return toDto(await this.prisma.listing.findUniqueOrThrow({ where: { id }, include: listingInclude }));
  }

  async publish(sellerId: string, id: string, input: PublishListingInput) {
    const listing = await this.getOwned(sellerId, id);
    if (listing.status === "PUBLISHED") throw new ConflictException("This listing is already published");
    if (listing.images.length === 0) throw new BadRequestException("Add at least one photo before publishing");

    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const endsAt = new Date(startsAt.getTime() + listing.durationDays * 86_400_000);
    const published = await this.prisma.listing.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date(), startsAt, endsAt },
      include: listingInclude,
    });
    return toDto(published);
  }

  async remove(sellerId: string, id: string) {
    const listing = await this.getOwned(sellerId, id);
    if (listing.status === "PUBLISHED") throw new ConflictException("Only drafts can be deleted");
    await this.prisma.listing.delete({ where: { id } });
    await this.storage.delete(listing.images.map((i) => i.url));
  }

  private async requireCategory(categoryId: string) {
    if (!(await this.prisma.category.findUnique({ where: { id: categoryId } }))) {
      throw new BadRequestException("Choose a valid category");
    }
  }

  // Someone else's draft looks like it does not exist; someone else's published listing is visible, so say 403.
  private async getOwned(sellerId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id }, include: listingInclude });
    if (!listing) throw new NotFoundException();
    if (listing.sellerId !== sellerId) {
      throw listing.status === "PUBLISHED" ? new ForbiddenException() : new NotFoundException();
    }
    return listing;
  }
}

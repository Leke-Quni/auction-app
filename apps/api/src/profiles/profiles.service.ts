import { PROFILE_LISTINGS_SHOWN, PROFILE_RATINGS_SHOWN, type SellerProfile } from "@auction/shared";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { listingCardInclude, toListingCard } from "../listings/listing-card";

// A seller's public page. Only the username is shown, never a real name or an email; ratings carry the rater's username.
@Injectable()
export class ProfilesService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async get(username: string): Promise<SellerProfile> {
    const user = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true, username: true, createdAt: true } });
    if (!user) throw new NotFoundException();
    const now = new Date();
    const [stats, ratings, listings] = await Promise.all([
      this.prisma.rating.aggregate({ where: { sellerId: user.id }, _avg: { stars: true }, _count: true }),
      this.prisma.rating.findMany({
        where: { sellerId: user.id },
        orderBy: { createdAt: "desc" },
        take: PROFILE_RATINGS_SHOWN,
        include: { buyer: { select: { username: true } }, order: { select: { listing: { select: { title: true } } } } },
      }),
      // What they have on sale now: live first (ending soonest), then upcoming.
      this.prisma.listing.findMany({
        where: { sellerId: user.id, status: "PUBLISHED", endsAt: { gt: now } },
        orderBy: [{ endsAt: "asc" }, { id: "asc" }],
        take: PROFILE_LISTINGS_SHOWN,
        include: listingCardInclude,
      }),
    ]);
    return {
      username: user.username,
      memberSince: user.createdAt.toISOString(),
      rating: { average: stats._avg.stars === null ? null : Math.round(stats._avg.stars * 10) / 10, count: stats._count },
      ratings: ratings.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, createdAt: r.createdAt.toISOString(), buyer: r.buyer, listingTitle: r.order.listing.title })),
      listings: listings.map((l) => toListingCard(l, now)) as unknown as SellerProfile["listings"],
    };
  }
}

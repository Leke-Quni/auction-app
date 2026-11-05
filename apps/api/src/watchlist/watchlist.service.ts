import { Prisma as PrismaNamespace } from "@auction/db";
import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { listingCardInclude, toListingCard } from "../listings/listing-card";

const DAY_MS = 24 * 3600_000;
// The most auctions a person can have on their watchlist page at once.
const WATCHLIST_LIMIT = 200;

// A person's watchlist. Watching a live or upcoming auction owes the watcher one email 24 hours before it ends (a
// PendingEndEmail row, due then and sent by the existing leased sweep); stopping removes both, in one transaction.
@Injectable()
export class WatchlistService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async watch(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { sellerId: true, status: true, endsAt: true } });
    if (!listing || listing.status !== "PUBLISHED" || !listing.endsAt) throw new NotFoundException();
    if (listing.sellerId === userId) throw new ForbiddenException({ code: "OWN_LISTING", message: "You cannot watch your own listing." });
    if (listing.endsAt.getTime() <= Date.now()) throw new HttpException({ code: "NOT_WATCHABLE", message: "This auction has ended." }, HttpStatus.CONFLICT);
    const dueAt = new Date(listing.endsAt.getTime() - DAY_MS);
    try {
      await this.prisma.$transaction(async (tx) => {
        // One person's watches take turns, so two at once cannot both slip under the cap.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        // Already watching is fine (a double click); a new watch past the cap is not.
        if ((await tx.watch.count({ where: { userId, listingId } })) === 0 && (await tx.watch.count({ where: { userId } })) >= WATCHLIST_LIMIT) {
          throw new HttpException({ code: "WATCHLIST_FULL", message: `You can watch up to ${WATCHLIST_LIMIT} auctions. Stop watching one first.` }, HttpStatus.CONFLICT);
        }
        const added = await tx.watch.createMany({ data: { userId, listingId }, skipDuplicates: true });
        // An auction already inside its last 24 hours owes no email: the reminder would be late by definition.
        if (added.count > 0 && dueAt.getTime() > Date.now()) {
          await tx.pendingEndEmail.upsert({
            where: { userId_listingId_kind: { userId, listingId, kind: "ENDING_SOON" } },
            create: { userId, listingId, kind: "ENDING_SOON", dueAt },
            update: { dueAt, attempts: 0 },
          });
        }
      });
    } catch (error) {
      // The seller removed the listing between the check above and the insert.
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === "P2003") throw new NotFoundException();
      throw error;
    }
    return this.state(userId, listingId);
  }

  async unwatch(userId: string, listingId: string) {
    await this.prisma.$transaction([
      this.prisma.watch.deleteMany({ where: { userId, listingId } }),
      this.prisma.pendingEndEmail.deleteMany({ where: { userId, listingId, kind: "ENDING_SOON" } }),
    ]);
    return this.state(userId, listingId);
  }

  private async state(userId: string, listingId: string) {
    const [watching, watcherCount] = await Promise.all([
      this.prisma.watch.count({ where: { userId, listingId } }),
      this.prisma.watch.count({ where: { listingId } }),
    ]);
    return { watching: watching > 0, watcherCount };
  }

  // Live auctions first (ending soonest), then upcoming (starting soonest), then ended (most recent first).
  async list(userId: string) {
    const now = new Date();
    const rows = await this.prisma.watch.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: WATCHLIST_LIMIT,
      include: { listing: { include: listingCardInclude } },
    });
    const items = rows.map(({ listing }) => toListingCard(listing, now));
    const group = { live: 0, upcoming: 1, ended: 2, draft: 3 } as const;
    const time = (d: Date | null) => d?.getTime() ?? 0;
    items.sort((a, b) => group[a.phase] - group[b.phase] || (a.phase === "ended" ? time(b.endsAt) - time(a.endsAt) : a.phase === "upcoming" ? time(a.startsAt) - time(b.startsAt) : time(a.endsAt) - time(b.endsAt)));
    return { items, total: items.length };
  }
}

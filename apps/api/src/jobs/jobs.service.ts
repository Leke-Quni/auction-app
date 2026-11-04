import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { AuctionCloseService } from "../auctions/auction-close.service";
import { AuctionEvents } from "../bids/auction-events";
import { PRISMA, type Prisma } from "../db/db.module";
import { OrderExpiryService } from "../orders/order-expiry.service";
import { JOB_SCHEDULER, type JobScheduler } from "./job-scheduler";

// What the scheduled calls do. Both are the same idempotent operations the sweeps run, so a duplicate, early or stale
// message changes nothing. A failure is thrown to the caller, which answers 5xx so QStash tries again.
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private subscription?: Subscription;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobScheduler,
    private readonly closer: AuctionCloseService,
    private readonly expiry: OrderExpiryService,
    private readonly events: AuctionEvents,
  ) {}

  // A late bid moves the end time, so the close is scheduled again for the new one. The message for the old time still
  // arrives and finds the auction open, which is why it schedules the next hop itself (see runClose).
  onModuleInit() {
    this.subscription = this.events.stream.subscribe((event) => {
      if (event.type === "AuctionExtended") void this.scheduler.scheduleClose(event.listingId, event.endsAt);
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  async runClose(listingId: string): Promise<{ closed: boolean }> {
    if (await this.closer.close(listingId)) return { closed: true };
    // Not closed: either it is already closed, or it is not over yet (the message came early because the end time was
    // extended, or because it was set no further out than QStash allows). In that case ask for the next one.
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { status: true, closedAt: true, endsAt: true } });
    if (listing?.status === "PUBLISHED" && listing.closedAt === null && listing.endsAt && listing.endsAt.getTime() > Date.now()) {
      await this.scheduler.scheduleClose(listingId, listing.endsAt);
    }
    return { closed: false };
  }

  async runExpireOrder(orderId: string): Promise<{ expired: boolean }> {
    if (await this.expiry.expire(orderId)) return { expired: true };
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, payBy: true } });
    if (order?.status === "AWAITING_PAYMENT" && order.payBy.getTime() > Date.now()) await this.scheduler.scheduleOrderExpiry(orderId, order.payBy);
    return { expired: false };
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";

// The numbers on the admin Overview page and the open-reports badge in the sidebar.
@Injectable()
export class AdminOverviewService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async get() {
    const now = new Date();
    const [openReports, openSupport, liveListings, upcomingListings, awaitingPaymentOrders, paidOrdersToShip, bannedUsers, users] = await Promise.all([
      this.prisma.report.count({ where: { status: "OPEN" } }),
      this.prisma.supportRequest.count({ where: { status: "OPEN" } }),
      this.prisma.listing.count({ where: { status: "PUBLISHED", startsAt: { lte: now }, endsAt: { gt: now } } }),
      this.prisma.listing.count({ where: { status: "PUBLISHED", startsAt: { gt: now } } }),
      this.prisma.order.count({ where: { status: "AWAITING_PAYMENT" } }),
      this.prisma.order.count({ where: { status: "PAID", shipmentStatus: null } }),
      this.prisma.user.count({ where: { bannedAt: { not: null } } }),
      this.prisma.user.count(),
    ]);
    return { openReports, openSupport, liveListings, upcomingListings, awaitingPaymentOrders, paidOrdersToShip, bannedUsers, users };
  }
}

import { Module } from "@nestjs/common";
import { AuctionsModule } from "../auctions/auctions.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AdminController } from "./admin.controller";
import { AdminAuditService } from "./admin-audit.service";
import { AdminListingsService } from "./admin-listings.service";
import { AdminSupportService } from "./admin-support.service";
import { AdminOverviewService } from "./admin-overview.service";
import { AdminOrdersService } from "./admin-orders.service";
import { AdminReportsService } from "./admin-reports.service";
import { AdminUsersService } from "./admin-users.service";

@Module({ imports: [AuctionsModule, RealtimeModule, NotificationsModule], controllers: [AdminController], providers: [AdminReportsService, AdminListingsService, AdminUsersService, AdminOrdersService, AdminAuditService, AdminOverviewService, AdminSupportService] })
export class AdminModule {}

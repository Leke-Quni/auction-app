import { Module } from "@nestjs/common";
import { AuctionsModule } from "../auctions/auctions.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AdminController } from "./admin.controller";
import { AdminListingsService } from "./admin-listings.service";
import { AdminReportsService } from "./admin-reports.service";
import { AdminUsersService } from "./admin-users.service";

@Module({ imports: [AuctionsModule, RealtimeModule], controllers: [AdminController], providers: [AdminReportsService, AdminListingsService, AdminUsersService] })
export class AdminModule {}

import { Module } from "@nestjs/common";
import { AuctionsModule } from "../auctions/auctions.module";
import { AdminController } from "./admin.controller";
import { AdminListingsService } from "./admin-listings.service";
import { AdminReportsService } from "./admin-reports.service";

@Module({ imports: [AuctionsModule], controllers: [AdminController], providers: [AdminReportsService, AdminListingsService] })
export class AdminModule {}

import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminReportsService } from "./admin-reports.service";

@Module({ controllers: [AdminController], providers: [AdminReportsService] })
export class AdminModule {}

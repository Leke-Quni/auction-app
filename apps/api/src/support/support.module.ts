import { Module } from "@nestjs/common";
import { SupportController } from "./support.controller";
import { SupportService } from "./support.service";
import { SuspendedSupportController } from "./suspended-support.controller";

@Module({ controllers: [SupportController, SuspendedSupportController], providers: [SupportService] })
export class SupportModule {}

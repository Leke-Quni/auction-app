import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { NotificationsService } from "./notifications.service";
import { RealtimeGateway } from "./realtime.gateway";

@Module({ imports: [BidsModule, NotificationsModule], providers: [RealtimeGateway, NotificationsService] })
export class RealtimeModule {}

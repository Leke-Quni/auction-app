import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { NotificationsService } from "./notifications.service";
import { RealtimeGateway } from "./realtime.gateway";

@Module({ imports: [BidsModule], providers: [RealtimeGateway, NotificationsService] })
export class RealtimeModule {}

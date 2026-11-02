import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { RealtimeGateway } from "./realtime.gateway";

@Module({ imports: [BidsModule], providers: [RealtimeGateway] })
export class RealtimeModule {}

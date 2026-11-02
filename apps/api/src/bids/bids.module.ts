import { Module } from "@nestjs/common";
import { AuctionEvents } from "./auction-events";
import { BidsController } from "./bids.controller";
import { BidsService } from "./bids.service";

@Module({ controllers: [BidsController], providers: [BidsService, AuctionEvents], exports: [BidsService, AuctionEvents] })
export class BidsModule {}

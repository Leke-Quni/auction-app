import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { AuctionCloseService } from "./auction-close.service";

@Module({ imports: [BidsModule], providers: [AuctionCloseService], exports: [AuctionCloseService] })
export class AuctionsModule {}

import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { AuctionCloseService } from "./auction-close.service";
import { AuctionEndEmailService } from "./auction-end-email.service";

@Module({ imports: [BidsModule], providers: [AuctionCloseService, AuctionEndEmailService], exports: [AuctionCloseService] })
export class AuctionsModule {}

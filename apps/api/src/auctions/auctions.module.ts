import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { AuctionCloseService } from "./auction-close.service";
import { MailOutbox } from "../email/mail-outbox.service";

@Module({ imports: [BidsModule], providers: [AuctionCloseService, MailOutbox], exports: [AuctionCloseService] })
export class AuctionsModule {}

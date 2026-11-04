import { Module } from "@nestjs/common";
import { AuctionsModule } from "../auctions/auctions.module";
import { BidsModule } from "../bids/bids.module";
import { OrdersModule } from "../orders/orders.module";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { QStashSignatureGuard } from "./qstash-signature.guard";

@Module({ imports: [AuctionsModule, BidsModule, OrdersModule], controllers: [JobsController], providers: [JobsService, QStashSignatureGuard] })
export class JobsModule {}

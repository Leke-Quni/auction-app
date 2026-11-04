import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { OrderExpiryService } from "./order-expiry.service";
import { OrdersController } from "./orders.controller";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { OrdersService } from "./orders.service";

@Module({ imports: [BidsModule], controllers: [OrdersController, StripeWebhookController], providers: [OrdersService, OrderExpiryService], exports: [OrdersService, OrderExpiryService] })
export class OrdersModule {}

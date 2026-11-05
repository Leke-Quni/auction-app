import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { ShipmentProgressService } from "./shipment-progress.service";
import { OrderExpiryService } from "./order-expiry.service";
import { OrdersController } from "./orders.controller";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { OrdersService } from "./orders.service";

@Module({ imports: [BidsModule], controllers: [OrdersController, StripeWebhookController], providers: [OrdersService, OrderExpiryService, ShipmentProgressService], exports: [OrdersService, OrderExpiryService] })
export class OrdersModule {}

import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { OrdersService } from "./orders.service";

@Module({ controllers: [OrdersController, StripeWebhookController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}

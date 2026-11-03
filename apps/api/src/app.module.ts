import { Module } from "@nestjs/common";
import { AuctionsModule } from "./auctions/auctions.module";
import { AuthModule } from "./auth/auth.module";
import { BidsModule } from "./bids/bids.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { HealthController } from "./health/health.controller";
import { OrdersModule } from "./orders/orders.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ListingsModule } from "./listings/listings.module";
import { PaymentsModule } from "./payments/payments.module";
import { QuestionsModule } from "./questions/questions.module";
import { RateLimitModule } from "./rate-limit/rate-limit.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SearchModule } from "./search/search.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [DbModule, RateLimitModule, EmailModule, SearchModule, AuthModule, UsersModule, ListingsModule, BidsModule, AuctionsModule, PaymentsModule, OrdersModule, NotificationsModule, QuestionsModule, RealtimeModule],
  controllers: [HealthController],
})
export class AppModule {}

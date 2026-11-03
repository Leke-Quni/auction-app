import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BidsModule } from "./bids/bids.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { HealthController } from "./health/health.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { ListingsModule } from "./listings/listings.module";
import { RateLimitModule } from "./rate-limit/rate-limit.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SearchModule } from "./search/search.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [DbModule, RateLimitModule, EmailModule, SearchModule, AuthModule, UsersModule, ListingsModule, BidsModule, NotificationsModule, RealtimeModule],
  controllers: [HealthController],
})
export class AppModule {}

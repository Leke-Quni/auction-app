import { Module } from "@nestjs/common";
import { AuctionsModule } from "./auctions/auctions.module";
import { AuthModule } from "./auth/auth.module";
import { BidsModule } from "./bids/bids.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { HealthController } from "./health/health.controller";
import { JobSchedulerModule } from "./jobs/job-scheduler.module";
import { JobsModule } from "./jobs/jobs.module";
import { ShippingModule } from "./shipping/shipping.module";
import { PayoutsModule } from "./payouts/payouts.module";
import { WatchlistModule } from "./watchlist/watchlist.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { AdminModule } from "./admin/admin.module";
import { OrdersModule } from "./orders/orders.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ListingsModule } from "./listings/listings.module";
import { PaymentsModule } from "./payments/payments.module";
import { QuestionsModule } from "./questions/questions.module";
import { RateLimitModule } from "./rate-limit/rate-limit.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SearchModule } from "./search/search.module";
import { SupportModule } from "./support/support.module";
import { UploadsModule } from "./uploads/uploads.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [DbModule, JobSchedulerModule, RateLimitModule, EmailModule, SearchModule, AuthModule, UsersModule, ListingsModule, BidsModule, AuctionsModule, PaymentsModule, ShippingModule, OrdersModule, PayoutsModule, WatchlistModule, ProfilesModule, AdminModule, NotificationsModule, QuestionsModule, SupportModule, UploadsModule, RealtimeModule, JobsModule],
  controllers: [HealthController],
})
export class AppModule {}

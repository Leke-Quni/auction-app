import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BidsModule } from "./bids/bids.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { HealthController } from "./health/health.controller";
import { ListingsModule } from "./listings/listings.module";
import { SearchModule } from "./search/search.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [DbModule, EmailModule, SearchModule, AuthModule, UsersModule, ListingsModule, BidsModule],
  controllers: [HealthController],
})
export class AppModule {}

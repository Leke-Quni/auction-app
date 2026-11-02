import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { HealthController } from "./health/health.controller";
import { ListingsModule } from "./listings/listings.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [DbModule, EmailModule, AuthModule, UsersModule, ListingsModule],
  controllers: [HealthController],
})
export class AppModule {}

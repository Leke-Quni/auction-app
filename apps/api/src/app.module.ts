import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { HealthController } from "./health/health.controller";
import { UsersModule } from "./users/users.module";

@Module({ imports: [DbModule, EmailModule, AuthModule, UsersModule], controllers: [HealthController] })
export class AppModule {}

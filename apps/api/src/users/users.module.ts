import { Module } from "@nestjs/common";
import { AccountService } from "./account.service";
import { UsersController } from "./users.controller";

@Module({ controllers: [UsersController], providers: [AccountService] })
export class UsersModule {}

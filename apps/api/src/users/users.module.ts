import { Module } from "@nestjs/common";
import { AuctionsModule } from "../auctions/auctions.module";
import { AccountDeletionService } from "./account-deletion.service";
import { AccountService } from "./account.service";
import { UsersController } from "./users.controller";

@Module({ imports: [AuctionsModule], controllers: [UsersController], providers: [AccountService, AccountDeletionService] })
export class UsersModule {}

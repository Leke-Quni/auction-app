import { Module } from "@nestjs/common";
import { PayoutAccountService } from "./payout-account.service";
import { PayoutService } from "./payout.service";
import { PayoutsController } from "./payouts.controller";

@Module({ controllers: [PayoutsController], providers: [PayoutAccountService, PayoutService], exports: [PayoutService] })
export class PayoutsModule {}

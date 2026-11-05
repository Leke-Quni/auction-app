import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Req } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { PayoutAccountService } from "./payout-account.service";

@Controller("me/payout-account")
@UseGuards(JwtAuthGuard)
export class PayoutsController {
  constructor(private readonly accounts: PayoutAccountService) {}

  @Get()
  status(@Req() req: { user: AuthUser }) {
    return this.accounts.status(req.user.id);
  }

  @Post("onboarding")
  onboarding(@Req() req: { user: AuthUser }) {
    return this.accounts.onboardingLink(req.user.id);
  }
}

import type { PayoutAccountStatus } from "@auction/shared";
import { Inject, Injectable } from "@nestjs/common";
import { webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider";

// A seller's connected payment account, where their share of each sale is paid. It is created the first time they ask to
// get paid, and the provider is asked about it live whenever its state is needed, so there is nothing to keep in step.
@Injectable()
export class PayoutAccountService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  async status(userId: string): Promise<{ status: PayoutAccountStatus }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { payoutAccountId: true } });
    if (!user.payoutAccountId) return { status: "NOT_STARTED" };
    return { status: (await this.payments.isPayoutAccountReady(user.payoutAccountId)) ? "READY" : "PENDING" };
  }

  // Creates the account if the seller has none, and returns the page where they set it up (or finish setting it up).
  async onboardingLink(userId: string): Promise<{ url: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, username: true, payoutAccountId: true } });
    let accountId = user.payoutAccountId;
    if (!accountId) {
      accountId = (await this.payments.createPayoutAccount({ sellerId: user.id, email: user.email, displayName: user.username })).accountId;
      // Two simultaneous first calls get the same account from the provider, so both save the same id.
      await this.prisma.user.update({ where: { id: user.id }, data: { payoutAccountId: accountId } });
    }
    const settings = `${webUrl()}/account/settings`;
    return this.payments.createOnboardingLink({ accountId, returnUrl: `${settings}?payouts=1`, refreshUrl: `${settings}?payouts=refresh` });
  }
}

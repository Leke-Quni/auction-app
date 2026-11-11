import { FakePaymentProvider } from "./fake-payment-provider";
import type { CheckoutRequest, PaymentProvider } from "./payment-provider";

// For the demo: buyers pay through the real provider (Stripe test mode), but the seller's side is simulated, so "Set up payouts"
// finishes at once with no provider page, every payout account counts as ready (nothing to lose when the API restarts), and a payout
// is recorded instead of sent. Real payouts are switched back on with `STRIPE_PAYOUTS=true`.
export class DemoPayoutsProvider implements PaymentProvider {
  private readonly demo = new FakePaymentProvider();

  constructor(private readonly real: PaymentProvider) {}

  createCheckout(request: CheckoutRequest) {
    return this.real.createCheckout(request);
  }

  confirm(sessionId: string) {
    return this.real.confirm(sessionId);
  }

  findOpenCheckout(sessionId: string) {
    return this.real.findOpenCheckout(sessionId);
  }

  expireCheckout(sessionId: string) {
    return this.real.expireCheckout(sessionId);
  }

  refund(sessionId: string) {
    return this.real.refund(sessionId);
  }

  createPayoutAccount(request: { sellerId: string; email: string; displayName: string }) {
    return this.demo.createPayoutAccount(request);
  }

  createOnboardingLink(request: { accountId: string; returnUrl: string; refreshUrl: string }) {
    return this.demo.createOnboardingLink(request);
  }

  async isPayoutAccountReady() {
    return true;
  }

  payout(request: { orderId: string; sellerId: string; accountId: string; amountCents: number; paymentRef: string }) {
    return this.demo.payout(request);
  }
}

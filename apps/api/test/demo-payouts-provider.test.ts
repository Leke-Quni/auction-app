import { describe, expect, it, vi } from "vitest";
import { DemoPayoutsProvider } from "../src/payments/demo-payouts-provider";
import type { PaymentProvider } from "../src/payments/payment-provider";

const realProvider = () => {
  const real = {
    createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" })),
    confirm: vi.fn(async () => ({ paid: true, amountCents: 1000 })),
    findOpenCheckout: vi.fn(async () => null),
    expireCheckout: vi.fn(async () => undefined),
    refund: vi.fn(async () => undefined),
    createPayoutAccount: vi.fn(),
    createOnboardingLink: vi.fn(),
    isPayoutAccountReady: vi.fn(),
    payout: vi.fn(),
  };
  return real as typeof real & PaymentProvider;
};

describe("DemoPayoutsProvider", () => {
  it("leaves buyers' payments to the real provider", async () => {
    const real = realProvider();
    const demo = new DemoPayoutsProvider(real);
    expect(await demo.createCheckout({ orderId: "o1", amountCents: 900, shippingCents: 100, shippingLabel: "x", description: "x", buyerEmail: "a@b.c" })).toMatchObject({ id: "cs_1" });
    expect(await demo.confirm("cs_1")).toEqual({ paid: true, amountCents: 1000 });
    await demo.findOpenCheckout("cs_1");
    await demo.expireCheckout("cs_1");
    await demo.refund("cs_1");
    expect(real.createCheckout).toHaveBeenCalledOnce();
    expect(real.confirm).toHaveBeenCalledOnce();
    expect(real.findOpenCheckout).toHaveBeenCalledOnce();
    expect(real.expireCheckout).toHaveBeenCalledOnce();
    expect(real.refund).toHaveBeenCalledOnce();
  });

  it("simulates the seller's side: setup finishes at once, every account is ready, and a payout is recorded, never sent", async () => {
    const real = realProvider();
    const demo = new DemoPayoutsProvider(real);
    const { accountId } = await demo.createPayoutAccount({ sellerId: "s1", email: "s@b.c", displayName: "s1" });
    expect(accountId).toBe("fake_acct_s1");
    const link = await demo.createOnboardingLink({ accountId, returnUrl: "http://localhost:3000/account/settings?payouts=1", refreshUrl: "http://localhost:3000/account/settings?payouts=refresh" });
    expect(link.url).toBe("http://localhost:3000/account/settings?payouts=demo");
    // Ready even for an account this process never saw (after a restart) and for a real Stripe id left from before.
    expect(await demo.isPayoutAccountReady()).toBe(true);
    expect(await demo.payout({ orderId: "o1", sellerId: "s1", accountId: "acct_123", amountCents: 950, paymentRef: "cs_1" })).toEqual({ reference: "fake_tr_o1" });
    expect(real.createPayoutAccount).not.toHaveBeenCalled();
    expect(real.createOnboardingLink).not.toHaveBeenCalled();
    expect(real.isPayoutAccountReady).not.toHaveBeenCalled();
    expect(real.payout).not.toHaveBeenCalled();
  });
});

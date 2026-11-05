import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { StripePaymentProvider } from "../src/payments/stripe-payment-provider";

const make = (overrides: Record<string, unknown> = {}) => {
  const stripe = {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })),
        retrieve: vi.fn(async () => ({ id: "cs_test_1", payment_status: "paid", payment_intent: "pi_1" })),
      },
    },
    refunds: { create: vi.fn(async () => ({})) },
    ...overrides,
  };
  return { stripe, provider: new StripePaymentProvider(stripe as unknown as Stripe, "whsec_test") };
};

describe("StripePaymentProvider", () => {
  it("creates a one-time EUR checkout for the order and returns Stripe's page", async () => {
    const { stripe, provider } = make();
    const session = await provider.createCheckout({ orderId: "ord1", amountCents: 3150, shippingCents: 300, shippingLabel: "Delivery: SimPost Standard", description: "A lamp", buyerEmail: "b@example.com" });
    expect(session).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        allowed_payment_method_types: ["card"],
        customer_email: "b@example.com",
        client_reference_id: "ord1",
        metadata: { orderId: "ord1" },
        line_items: [
          { quantity: 1, price_data: { currency: "eur", unit_amount: 3150, product_data: { name: "A lamp" } } },
          { quantity: 1, price_data: { currency: "eur", unit_amount: 300, product_data: { name: "Delivery: SimPost Standard" } } },
        ],
        success_url: expect.stringMatching(/\/orders\/ord1\?paid=1$/),
        cancel_url: expect.stringMatching(/\/orders\/ord1$/),
      }),
    );
  });

  it("fails if Stripe gives no checkout URL", async () => {
    const { provider } = make({ checkout: { sessions: { create: async () => ({ id: "cs_x", url: null }) } } });
    await expect(provider.createCheckout({ orderId: "o", amountCents: 100, shippingCents: 0, shippingLabel: "d", description: "x", buyerEmail: "b@example.com" })).rejects.toThrow(/without a URL/);
  });

  it("reports paid only when Stripe says the session is paid", async () => {
    const paid = make();
    expect(await paid.provider.confirm("cs_test_1")).toEqual({ paid: true });
    const open = make({ checkout: { sessions: { retrieve: async () => ({ payment_status: "unpaid" }) } } });
    expect(await open.provider.confirm("cs_test_1")).toEqual({ paid: false });
  });

  it("refunds a paid session once per session, with an idempotency key", async () => {
    const { stripe, provider } = make();
    await provider.refund("cs_test_1");
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_1" }, { idempotencyKey: "refund_cs_test_1" });
  });

  it("does not refund a session that was never paid", async () => {
    const { stripe, provider } = make({ checkout: { sessions: { retrieve: async () => ({ payment_status: "unpaid", payment_intent: null }) } } });
    await provider.refund("cs_test_1");
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("creates a recipient account with the Express dashboard and the platform owning fees and losses", async () => {
    const create = vi.fn(async () => ({ id: "acct_1" }));
    const { provider } = make({ v2: { core: { accounts: { create } } } });
    expect(await provider.createPayoutAccount({ sellerId: "u1", email: "s@example.com", displayName: "sam" })).toEqual({ accountId: "acct_1" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboard: "express",
        defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
        configuration: {
          recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
          merchant: { capabilities: { card_payments: { requested: true } } },
        },
      }),
      { idempotencyKey: "payout_account_u1" },
    );
  });

  it("is ready to pay only when the account's transfer capability is active", async () => {
    const status = (s: string) => make({ v2: { core: { accounts: { retrieve: async () => ({ configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: s } } } } } }) } } } }).provider;
    expect(await status("active").isPayoutAccountReady("acct_1")).toBe(true);
    expect(await status("pending").isPayoutAccountReady("acct_1")).toBe(false);
  });

  const payFrom = (currency: string | null) => {
    const create = vi.fn(async () => ({ id: "tr_1" }));
    const charge = { id: "ch_1", balance_transaction: currency ? { currency } : null };
    const { provider } = make({ checkout: { sessions: { retrieve: async () => ({ payment_intent: { latest_charge: charge } }) } }, transfers: { create } });
    return { create, pay: () => provider.payout({ orderId: "o1", sellerId: "u1", accountId: "acct_1", amountCents: 18866, paymentRef: "cs_test_1" }) };
  };

  it("pays the seller by a transfer tied to the buyer's charge when that charge settled in euros, once per order", async () => {
    const { create, pay } = payFrom("eur");
    expect(await pay()).toEqual({ reference: "tr_1" });
    expect(create).toHaveBeenCalledWith(
      { amount: 18866, currency: "eur", destination: "acct_1", source_transaction: "ch_1", transfer_group: "order_o1" },
      { idempotencyKey: "payout_o1" },
    );
  });

  it("pays from the available balance, not tied to the charge, when the charge settled in another currency", async () => {
    for (const currency of ["usd", null]) {
      const { create, pay } = payFrom(currency);
      await pay();
      expect(create).toHaveBeenCalledWith({ amount: 18866, currency: "eur", destination: "acct_1", transfer_group: "order_o1" }, { idempotencyKey: "payout_o1" });
    }
  });

  it("refuses to pay when the payment has no charge", async () => {
    const { provider } = make({ checkout: { sessions: { retrieve: async () => ({ payment_intent: null }) } } });
    await expect(provider.payout({ orderId: "o1", sellerId: "u1", accountId: "acct_1", amountCents: 100, paymentRef: "cs" })).rejects.toThrow(/no charge/);
  });
});

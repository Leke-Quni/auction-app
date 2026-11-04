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

  it("refuses payouts until sellers can be paid", async () => {
    await expect(make().provider.payout()).rejects.toThrow(/not built yet/);
  });
});

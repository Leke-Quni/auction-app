import Stripe from "stripe";
import { webUrl } from "../config";
import type { CheckoutRequest, CheckoutSession, PaymentProvider } from "./payment-provider";

// Stripe Checkout (hosted page) in the account's mode: test keys (`sk_test_`) mean test mode. The buyer pays on Stripe's
// page and comes back to `/orders/:id?paid=1`, which asks `confirm`; the webhook marks the order paid as well, in case
// the buyer closes the tab first.
export class StripePaymentProvider implements PaymentProvider {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      // The design is card payments; the account would otherwise also offer banks and wallets, some of which pay later.
      allowed_payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "eur", unit_amount: request.amountCents, product_data: { name: request.description } },
        },
        ...(request.shippingCents > 0
          ? [{ quantity: 1, price_data: { currency: "eur", unit_amount: request.shippingCents, product_data: { name: request.shippingLabel } } }]
          : []),
      ],
      customer_email: request.buyerEmail,
      client_reference_id: request.orderId,
      metadata: { orderId: request.orderId },
      success_url: `${webUrl()}/orders/${request.orderId}?paid=1`,
      cancel_url: `${webUrl()}/orders/${request.orderId}`,
    });
    if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
    return { id: session.id, url: session.url };
  }

  async confirm(sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    return { paid: session.payment_status === "paid", amountCents: session.amount_total ?? undefined };
  }

  async findOpenCheckout(sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== "open" || !session.url || session.amount_total == null) return null;
    return { url: session.url, amountCents: session.amount_total };
  }

  async expireCheckout(sessionId: string) {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      // A session that is already paid, expired or closed cannot be expired again; that is the outcome we wanted.
      if ((error as { type?: string }).type !== "StripeInvalidRequestError") throw error;
    }
  }

  async refund(sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (session.payment_status !== "paid" || !intent) return;
    // The key makes a repeat call refund once.
    try {
      await this.stripe.refunds.create({ payment_intent: intent }, { idempotencyKey: `refund_${sessionId}` });
    } catch (error) {
      if ((error as { code?: string }).code === "charge_already_refunded") return;
      throw error;
    }
  }

  // Paying a seller needs a connected Stripe account for them, and sellers have no onboarding yet. Slice 6 (shipping and
  // payout) decides how sellers are paid, so this refuses rather than pretend.
  async payout(): Promise<void> {
    throw new Error("Seller payouts through Stripe are not built yet (slice 6)");
  }

  // Checks the signature on a webhook call against the exact bytes Stripe sent, and returns the event. Throws if the
  // signature is wrong or too old.
  parseWebhook(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}

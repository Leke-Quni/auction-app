export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export interface CheckoutRequest {
  orderId: string;
  amountCents: number;
  description: string;
  buyerEmail: string;
}

export interface CheckoutSession {
  // The provider's id for this attempt to pay; kept on the order.
  id: string;
  // Where to send the buyer to pay.
  url: string;
}

// Everything the app needs from a payment service, so Stripe, the in-memory fake, or another provider can be swapped in.
// Amounts are whole euro cents.
export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  // Asks the provider whether the session has been paid. Safe to call any number of times.
  confirm(sessionId: string): Promise<{ paid: boolean }>;
  // Gives the money back for a paid session.
  refund(sessionId: string): Promise<void>;
  // Pays the seller their share of a sale. Declared now and used by the shipping work in slice 6.
  payout(request: { orderId: string; sellerId: string; amountCents: number }): Promise<void>;
}

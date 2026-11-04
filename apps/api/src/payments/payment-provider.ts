export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export interface CheckoutRequest {
  orderId: string;
  // The item's price, and the delivery on top of it; the buyer is charged both.
  amountCents: number;
  shippingCents: number;
  shippingLabel: string;
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
  // Asks the provider whether the session has been paid, and for how much. Safe to call any number of times.
  confirm(sessionId: string): Promise<{ paid: boolean; amountCents?: number }>;
  // The checkout page of a session that can still be paid (not paid, expired or closed), with the total it asks for, or null.
  findOpenCheckout(sessionId: string): Promise<{ url: string; amountCents: number } | null>;
  // Closes a session so it can no longer be paid. Does nothing for one that is already paid or closed.
  expireCheckout(sessionId: string): Promise<void>;
  // Gives the money back for a paid session. Safe to call again: a session is refunded once.
  refund(sessionId: string): Promise<void>;
  // Pays the seller their share of a sale. Declared now and used by the shipping work in slice 6.
  payout(request: { orderId: string; sellerId: string; amountCents: number }): Promise<void>;
}

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
  // A seller's connected account, where their share is paid. Created once per seller; asking again with the same seller
  // returns the same account.
  createPayoutAccount(request: { sellerId: string; email: string; displayName: string }): Promise<{ accountId: string }>;
  // A single-use page where the seller gives the provider what it needs to pay them (identity, bank account).
  createOnboardingLink(request: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }>;
  // Whether the provider can pay this account now (onboarding finished and not restricted).
  isPayoutAccountReady(accountId: string): Promise<boolean>;
  // Pays the seller their share of a paid order, taken from the buyer's payment (`paymentRef`, the checkout session).
  // Safe to call again for the same order: the provider pays once.
  payout(request: { orderId: string; sellerId: string; accountId: string; amountCents: number; paymentRef: string }): Promise<{ reference: string }>;
}

import { randomUUID } from "node:crypto";
import { webUrl } from "../config";
import type { CheckoutRequest, CheckoutSession, PaymentProvider } from "./payment-provider";

interface FakeSession extends CheckoutRequest {
  paid: boolean;
  refunded: boolean;
  expired: boolean;
}

// A payment provider that keeps everything in memory, for tests and for running the app without a payment account.
// Its "checkout" is a page of our own (`/orders/:id/checkout`) that calls `simulatePayment`. Sessions are lost when the
// process restarts, so a buyer then simply starts the payment again.
export class FakePaymentProvider implements PaymentProvider {
  readonly sessions = new Map<string, FakeSession>();
  readonly payouts: { orderId: string; sellerId: string; amountCents: number }[] = [];

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const id = `fake_${randomUUID()}`;
    this.sessions.set(id, { ...request, paid: false, refunded: false, expired: false });
    return { id, url: `${webUrl()}/orders/${request.orderId}/checkout?session=${id}` };
  }

  async confirm(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return { paid: session?.paid ?? false, ...(session ? { amountCents: session.amountCents + session.shippingCents } : {}) };
  }

  async findOpenCheckout(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.paid || session.expired) return null;
    return { url: `${webUrl()}/orders/${session.orderId}/checkout?session=${sessionId}`, amountCents: session.amountCents + session.shippingCents };
  }

  async expireCheckout(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && !session.paid) session.expired = true;
  }

  async refund(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session?.paid) session.refunded = true;
  }

  async payout(request: { orderId: string; sellerId: string; amountCents: number }) {
    this.payouts.push(request);
  }

  /** Marks a session paid, as the buyer's card going through would. Returns false for an unknown session. */
  simulatePayment(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.expired) return false;
    session.paid = true;
    return true;
  }
}

import { randomUUID } from "node:crypto";
import { webUrl } from "../config";
import type { CheckoutRequest, CheckoutSession, PaymentProvider } from "./payment-provider";

interface FakeSession extends CheckoutRequest {
  paid: boolean;
  refunded: boolean;
}

// A payment provider that keeps everything in memory, for tests and for running the app without a payment account.
// Its "checkout" is a page of our own (`/orders/:id/checkout`) that calls `simulatePayment`. Sessions are lost when the
// process restarts, so a buyer then simply starts the payment again.
export class FakePaymentProvider implements PaymentProvider {
  readonly sessions = new Map<string, FakeSession>();
  readonly payouts: { orderId: string; sellerId: string; amountCents: number }[] = [];

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const id = `fake_${randomUUID()}`;
    this.sessions.set(id, { ...request, paid: false, refunded: false });
    return { id, url: `${webUrl()}/orders/${request.orderId}/checkout?session=${id}` };
  }

  async confirm(sessionId: string) {
    return { paid: this.sessions.get(sessionId)?.paid ?? false };
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
    if (!session) return false;
    session.paid = true;
    return true;
  }
}

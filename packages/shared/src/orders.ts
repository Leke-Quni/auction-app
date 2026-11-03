// What a sale becomes after an auction closes: an order the winner pays within a window, minus the platform's fee.

export const ORDER_STATUSES = ["AWAITING_PAYMENT", "PAID", "EXPIRED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// How long the winner has to pay (also the runner-up, when the item is offered on).
export const PAYMENT_WINDOW_HOURS = 48;

// The platform's share of the final price, taken from the seller. Config on the API (`PLATFORM_FEE_PERCENT`).
export const DEFAULT_PLATFORM_FEE_PERCENT = 5;

/** The fee in whole cents, rounded to the nearest cent (a half rounds up). */
export function platformFeeCents(amountCents: number, percent: number): number {
  return Math.round((amountCents * percent) / 100);
}

export const ORDER_REFUSALS = ["NOT_FOUND", "NOT_BUYER", "NOT_PAYABLE", "PAYMENT_WINDOW_CLOSED"] as const;
export type OrderRefusal = (typeof ORDER_REFUSALS)[number];

export const ORDER_REFUSAL_MESSAGES: Record<OrderRefusal, string> = {
  NOT_FOUND: "That order does not exist.",
  NOT_BUYER: "Only the buyer can pay for this order.",
  NOT_PAYABLE: "This order is not waiting for payment.",
  PAYMENT_WINDOW_CLOSED: "The time to pay for this order has run out.",
};

// An order as its buyer or seller sees it. The fee and the seller's share are only sent to the seller.
export interface OrderView {
  id: string;
  listingId: string;
  title: string;
  status: OrderStatus;
  amountCents: number;
  payBy: string;
  paidAt: string | null;
  viewer: "buyer" | "seller";
  buyer: { id: string; username: string };
  seller: { id: string; username: string };
  feeCents?: number;
  sellerNetCents?: number;
}

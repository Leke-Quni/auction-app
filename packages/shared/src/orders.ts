// What a sale becomes after an auction closes: an order the winner pays within a window, minus the platform's fee.

export const ORDER_STATUSES = ["AWAITING_PAYMENT", "PAID", "EXPIRED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// How long the winner has to pay (also the runner-up, when the item is offered on).
export const PAYMENT_WINDOW_HOURS = 48;
// The buyer is reminded once, when this many hours are left to pay.
export const PAYMENT_REMINDER_HOURS = 24;

// A buyer who wins and does not pay in time gets a strike; this many block bidding. Strikes never expire.
export const MAX_STRIKES = 2;
/** How many buyers an item is offered to in all (the winner and then the next bidders) before the auction ends without a sale. */
export const MAX_PAYMENT_ROUNDS = 3;

// The platform's share of the final price (not of shipping), taken from the seller, and the most it can come to.
// Config on the API (`PLATFORM_FEE_PERCENT`, `PLATFORM_FEE_CAP_CENTS`).
export const DEFAULT_PLATFORM_FEE_PERCENT = 5;
export const DEFAULT_PLATFORM_FEE_CAP_CENTS = 5000;

/** The fee in whole cents, rounded to the nearest cent (a half rounds up) and never above `capCents` when one is given. */
export function platformFeeCents(amountCents: number, percent: number, capCents?: number): number {
  const fee = Math.round((amountCents * percent) / 100);
  return capCents === undefined ? fee : Math.min(fee, capCents);
}

// Where a paid order's parcel is, once the seller has marked it shipped. The carrier moves it on by itself.
export const SHIPMENT_STATUSES = ["LABEL_CREATED", "IN_TRANSIT", "DELIVERED"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const ORDER_REFUSALS = ["NOT_FOUND", "NOT_BUYER", "NOT_PAYABLE", "PAYMENT_WINDOW_CLOSED", "SHIPPING_REQUIRED", "SHIPPING_OPTION_UNAVAILABLE", "NOT_PAID", "NOT_SELLER", "ALREADY_SHIPPED", "NOT_DELIVERED", "ALREADY_RATED"] as const;
export type OrderRefusal = (typeof ORDER_REFUSALS)[number];

export const ORDER_REFUSAL_MESSAGES: Record<OrderRefusal, string> = {
  NOT_FOUND: "That order does not exist.",
  NOT_BUYER: "Only the buyer can pay for this order.",
  NOT_PAYABLE: "This order is not waiting for payment.",
  PAYMENT_WINDOW_CLOSED: "The time to pay for this order has run out.",
  SHIPPING_REQUIRED: "Enter the delivery address and choose a delivery option before paying.",
  SHIPPING_OPTION_UNAVAILABLE: "That delivery option is no longer available. Choose another.",
  NOT_PAID: "There is no invoice until the order is paid.",
  NOT_SELLER: "Only the seller can mark this order as shipped.",
  ALREADY_SHIPPED: "This order is already marked as shipped.",
  NOT_DELIVERED: "You can rate the seller once the item has been delivered.",
  ALREADY_RATED: "You have already rated this seller for this order.",
};

// An order as its buyer or seller sees it. The fee and the seller's share are only sent to the seller; the delivery price
// and the total only to the buyer (the seller sees what their item sold for, the fee taken, and what they receive).
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
  // Delivery details: null until the buyer has chosen them. The total is the price plus shipping.
  shipping: OrderShipping | null;
  totalCents: number | null;
  invoiceNumber: string | null;
  // Whether the buyer asked for emails about the parcel's progress. Only the buyer is sent it.
  trackingEmails?: boolean;
  // Null until the seller marks the paid order shipped.
  shipment: OrderShipment | null;
  // What the buyer rated the seller, once they have (both sides see it).
  rating?: import("./ratings").RatingView | null;
  // The seller's payout for a paid order (never sent to the buyer).
  payout?: OrderPayout;
  feeCents?: number;
  sellerNetCents?: number;
  // Where the carrier collects the item. Only the seller is sent it.
  pickupAddress?: import("./shipping").ShippingAddress;
}

export interface OrderShipping {
  // The buyer sees the whole address; the seller only the city and country, since the carrier handles the delivery.
  address: Pick<import("./shipping").ShippingAddress, "city" | "country"> & Partial<import("./shipping").ShippingAddress>;
  optionId: string;
  name: string;
  estimatedDays: number;
  tracked: boolean;
  insured: boolean;
  // The delivery price. Only the buyer is sent it: the seller never sees what the buyer paid for delivery.
  priceCents?: number;
}

// What a seller is told about getting paid for a paid order. Only the seller is sent it.
export interface OrderPayout {
  // SCHEDULED: due after the delivery delay. WAITING_FOR_ACCOUNT: due, but the seller has not set up their payment account.
  status: "NOT_DELIVERED" | "SCHEDULED" | "WAITING_FOR_ACCOUNT" | "PAID";
  // When it becomes due (3 days after delivery); null until the parcel is delivered.
  dueAt: string | null;
  paidAt: string | null;
  amountCents: number;
}

export type PayoutAccountStatus = "NOT_STARTED" | "PENDING" | "READY";

export interface OrderShipment {
  status: ShipmentStatus;
  trackingCode: string;
  shippedAt: string;
  inTransitAt: string | null;
  deliveredAt: string | null;
}

// Orders an admin should look at (the Orders page filter and the Overview count). Each is a state that normally clears by itself,
// so one that lasts this long means something is stuck: a buyer about to be struck, a seller not shipping, a parcel that never arrives,
// a payout that did not go out.
export const ORDER_ATTENTION_KINDS = ["expiring", "overdue", "not-shipped", "not-delivered", "payout-late"] as const;
export type OrderAttentionKind = (typeof ORDER_ATTENTION_KINDS)[number];
export const ORDER_ATTENTION_LABELS: Record<OrderAttentionKind, string> = {
  expiring: "Payment due within 24 hours",
  overdue: "Past its payment deadline",
  "not-shipped": "Paid, not shipped for 3 days",
  "not-delivered": "Shipped, not delivered for 7 days",
  "payout-late": "Payout late",
};
export const ORDER_ATTENTION = { expiringHours: 24, notShippedDays: 3, notDeliveredDays: 7, payoutGraceDays: 1 } as const;

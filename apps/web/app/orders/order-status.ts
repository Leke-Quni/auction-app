import type { OrderView } from "@auction/shared";

// What an order is waiting for, in a few words, for the "My orders" list. `action` is true when it is the viewer's turn
// (pay, ship, rate), so the list can point it out.
export function orderStatusLabel(order: OrderView): { label: string; action: boolean } {
  const buyer = order.viewer === "buyer";
  if (order.status === "AWAITING_PAYMENT") return buyer ? { label: "Pay now", action: true } : { label: "Waiting for the buyer to pay", action: false };
  if (order.status === "EXPIRED") return { label: "Not paid in time", action: false };
  if (order.status === "CANCELLED") return { label: "Cancelled", action: false };
  const shipment = order.shipment?.status;
  if (!shipment) return buyer ? { label: "Paid, waiting for the seller to ship", action: false } : { label: "Paid: ship it", action: true };
  if (shipment === "LABEL_CREATED") return { label: "Shipped", action: false };
  if (shipment === "IN_TRANSIT") return { label: "In transit", action: false };
  if (buyer) return order.rating ? { label: "Delivered", action: false } : { label: "Delivered: rate the seller", action: true };
  if (order.payout?.status === "PAID") return { label: "Delivered, paid out", action: false };
  if (order.payout?.status === "WAITING_FOR_ACCOUNT") return { label: "Delivered: set up payouts", action: true };
  return { label: "Delivered, payout scheduled", action: false };
}

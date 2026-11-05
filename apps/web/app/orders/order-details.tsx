import Link from "next/link";
import { SHIPPING_COUNTRIES, formatEur, type OrderView, type ShippingCountry } from "@auction/shared";
import { LocalTime } from "@/app/local-time";
import { Stars } from "@/app/stars";

const STATUS_LABELS: Record<OrderView["status"], string> = {
  AWAITING_PAYMENT: "Waiting for payment",
  PAID: "Paid",
  EXPIRED: "Not paid in time",
  CANCELLED: "Cancelled",
};

const PAYOUT_LABELS: Record<NonNullable<OrderView["payout"]>["status"], string> = {
  NOT_DELIVERED: "After delivery",
  SCHEDULED: "Scheduled",
  WAITING_FOR_ACCOUNT: "Waiting for you to set up payouts",
  PAID: "Paid",
};

const SHIPMENT_LABELS: Record<NonNullable<OrderView["shipment"]>["status"], string> = {
  LABEL_CREATED: "Label created",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
};

// What an order is, to the person looking at it: the buyer sees the price, the seller also sees the fee and their share.
export function OrderDetails({ order }: { order: OrderView }) {
  const rows: [string, React.ReactNode][] = [
    ["Item", <Link key="i" href={`/listings/${order.listingId}`} className="text-brand underline">{order.title}</Link>],
    [order.viewer === "seller" ? "Sold for" : "Price", <span key="p" className="font-bold">{formatEur(order.amountCents)}</span>],
    ...(order.shipping
      ? ([
          ["Delivery", `${order.shipping.name}, about ${order.shipping.estimatedDays} days${order.shipping.tracked ? ", tracked" : ""}${order.shipping.insured ? ", insured" : ""}${order.shipping.priceCents === undefined ? "" : `: ${formatEur(order.shipping.priceCents)}`}`],
          [
            order.viewer === "buyer" ? "Deliver to" : "Destination",
            <span key="a" className="whitespace-pre-line">
              {[order.shipping.address.name, order.shipping.address.line1, order.shipping.address.line2, [order.shipping.address.postcode, order.shipping.address.city].filter(Boolean).join(" "), SHIPPING_COUNTRIES[order.shipping.address.country as ShippingCountry] ?? order.shipping.address.country].filter(Boolean).join("\n")}
            </span>,
          ],
          ...(order.viewer === "buyer" ? ([["Total", <span key="t" className="font-bold">{formatEur(order.totalCents ?? order.amountCents)}</span>]] as [string, React.ReactNode][]) : []),
        ] as [string, React.ReactNode][])
      : []),
    ...(order.viewer === "seller" && order.feeCents !== undefined && order.sellerNetCents !== undefined
      ? ([
          ["Platform fee", formatEur(order.feeCents)],
          ["You receive", <span key="n" className="font-bold">{formatEur(order.sellerNetCents)}</span>],
        ] as [string, React.ReactNode][])
      : []),
    [
      order.viewer === "buyer" ? "Seller" : "Buyer",
      order.viewer === "buyer" ? <Link key="sp" href={`/sellers/${order.seller.username}`} className="text-brand underline">{order.seller.username}</Link> : order.buyer.username,
    ],
    ["Status", STATUS_LABELS[order.status]],
    order.status === "PAID" && order.paidAt ? ["Paid", <LocalTime key="t" iso={order.paidAt} />] : ["Pay by", <LocalTime key="t" iso={order.payBy} />],
    ...(order.viewer === "buyer" && order.shipping ? ([["Tracking emails", order.trackingEmails ? "Yes" : "No"]] as [string, React.ReactNode][]) : []),
    ...(order.rating
      ? ([
          [
            order.viewer === "buyer" ? "Your rating" : "Buyer's rating",
            <span key="rt">
              <Stars value={order.rating.stars} />
              {order.rating.comment ? <span className="ml-2 whitespace-pre-wrap">{order.rating.comment}</span> : null}
            </span>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...(order.viewer === "seller" && order.payout
      ? ([
          ["Payout", <span key="po" className="font-bold">{PAYOUT_LABELS[order.payout.status]}</span>],
          ...(order.payout.status === "PAID" && order.payout.paidAt
            ? ([["Paid out", <LocalTime key="pp" iso={order.payout.paidAt} />]] as [string, React.ReactNode][])
            : order.payout.dueAt
              ? ([["Payout due", <LocalTime key="pd" iso={order.payout.dueAt} />]] as [string, React.ReactNode][])
              : []),
        ] as [string, React.ReactNode][])
      : []),
    ...(order.shipment
      ? ([
          ["Shipment", <span key="s" className="font-bold">{SHIPMENT_LABELS[order.shipment.status]}</span>],
          ["Tracking code", order.shipment.trackingCode],
          ["Shipped", <LocalTime key="sh" iso={order.shipment.shippedAt} />],
          ...(order.shipment.inTransitAt ? ([["In transit", <LocalTime key="it" iso={order.shipment.inTransitAt} />]] as [string, React.ReactNode][]) : []),
          ...(order.shipment.deliveredAt ? ([["Delivered", <LocalTime key="d" iso={order.shipment.deliveredAt} />]] as [string, React.ReactNode][]) : []),
        ] as [string, React.ReactNode][])
      : []),
    ...(order.status === "PAID" && order.invoiceNumber
      ? ([["Invoice", <a key="inv" href={`/orders/${order.id}/invoice`} className="text-brand underline">{order.invoiceNumber} (PDF)</a>]] as [string, React.ReactNode][])
      : []),
  ];
  return (
    <table className="w-full border-collapse bg-white">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th className="w-36 border border-line bg-[#f0f0f0] p-1.5 text-left font-normal text-muted">{label}</th>
            <td className="border border-line p-1.5">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

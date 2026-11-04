import Link from "next/link";
import { SHIPPING_COUNTRIES, formatEur, type OrderView, type ShippingCountry } from "@auction/shared";
import { LocalTime } from "@/app/local-time";

const STATUS_LABELS: Record<OrderView["status"], string> = {
  AWAITING_PAYMENT: "Waiting for payment",
  PAID: "Paid",
  EXPIRED: "Not paid in time",
  CANCELLED: "Cancelled",
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
    [order.viewer === "buyer" ? "Seller" : "Buyer", order.viewer === "buyer" ? order.seller.username : order.buyer.username],
    ["Status", STATUS_LABELS[order.status]],
    order.status === "PAID" && order.paidAt ? ["Paid", <LocalTime key="t" iso={order.paidAt} />] : ["Pay by", <LocalTime key="t" iso={order.payBy} />],
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

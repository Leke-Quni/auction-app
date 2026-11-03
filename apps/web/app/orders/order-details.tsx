import Link from "next/link";
import { formatEur, type OrderView } from "@auction/shared";
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
    ["Price", <span key="p" className="font-bold">{formatEur(order.amountCents)}</span>],
    ...(order.viewer === "seller" && order.feeCents !== undefined && order.sellerNetCents !== undefined
      ? ([
          ["Platform fee", formatEur(order.feeCents)],
          ["You receive", <span key="n" className="font-bold">{formatEur(order.sellerNetCents)}</span>],
        ] as [string, React.ReactNode][])
      : []),
    [order.viewer === "buyer" ? "Seller" : "Buyer", order.viewer === "buyer" ? order.seller.username : order.buyer.username],
    ["Status", STATUS_LABELS[order.status]],
    order.status === "PAID" && order.paidAt ? ["Paid", <LocalTime key="t" iso={order.paidAt} />] : ["Pay by", <LocalTime key="t" iso={order.payBy} />],
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

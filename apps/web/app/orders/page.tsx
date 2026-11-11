import { formatEur, type OrderView } from "@auction/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalTime } from "@/app/local-time";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { orderStatusLabel } from "./order-status";

function OrderTable({ orders, empty, other }: { orders: OrderView[]; empty: string; other: "Seller" | "Buyer" }) {
  if (orders.length === 0) return <p className="border border-line bg-surface p-4 text-muted">{empty}</p>;
  return (
    <table className="w-full border-collapse bg-surface">
      <thead>
        <tr className="bg-head text-left text-xs font-normal text-muted">
          <th className="border border-line p-1.5 font-normal">Item</th>
          <th className="border border-line p-1.5 font-normal">{other}</th>
          <th className="border border-line p-1.5 font-normal">Price</th>
          <th className="border border-line p-1.5 font-normal">Status</th>
          <th className="border border-line p-1.5 font-normal">Date</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const { label, action } = orderStatusLabel(o);
          return (
            <tr key={o.id}>
              <td className="border border-line p-1.5">
                <Link href={`/orders/${o.id}`} className="text-brand underline">
                  {o.title}
                </Link>
              </td>
              <td className="border border-line p-1.5">
                {other === "Seller" ? (
                  <Link href={`/sellers/${o.seller.username}`} className="text-brand underline">
                    {o.seller.username}
                  </Link>
                ) : (
                  o.buyer.username
                )}
              </td>
              <td className="border border-line p-1.5">{formatEur(o.amountCents)}</td>
              <td className="border border-line p-1.5">
                {/* What needs doing is a link to the order, where the pay, ship, rate or set-up button is. */}
                {action ? (
                  <Link href={`/orders/${o.id}`} className="font-bold text-brand underline">
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </td>
              <td className="border border-line p-1.5">
                <LocalTime iso={o.paidAt ?? o.payBy} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function MyOrdersPage() {
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch("/orders");
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /orders failed: ${res.status}`);
  const orders: OrderView[] = await res.json();

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">My orders</h1>
      <section className="space-y-2">
        <h2 className="border border-line bg-surface p-2 font-bold">Purchases</h2>
        <OrderTable orders={orders.filter((o) => o.viewer === "buyer")} empty="You have not won anything yet." other="Seller" />
      </section>
      <section className="space-y-2">
        <h2 className="border border-line bg-surface p-2 font-bold">Sales</h2>
        <OrderTable orders={orders.filter((o) => o.viewer === "seller")} empty="Nothing you listed has sold yet." other="Buyer" />
      </section>
    </div>
  );
}

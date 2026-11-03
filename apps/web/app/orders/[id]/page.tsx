import { formatEur, type OrderView } from "@auction/shared";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { startPaymentAction } from "../actions";
import { OrderDetails } from "../order-details";
import { PayButton } from "../pay-button";

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { id } = await params;
  if (!(await auth())) redirect("/sign-in");
  const { paid } = await searchParams;
  // Coming back from the payment provider: check with it before showing the order.
  if (paid) await authedApiFetch(`/orders/${id}/confirm`, { method: "POST" });
  const res = await authedApiFetch(`/orders/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /orders/${id} failed: ${res.status}`);
  const order: OrderView = await res.json();

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="border border-line bg-white p-2 text-lg font-bold">{order.viewer === "buyer" ? "Your purchase" : "Your sale"}</h1>
      {order.status === "PAID" && (
        <p role="status" className="border border-time-ok bg-white p-2 font-bold text-time-ok">
          {order.viewer === "buyer" ? "Payment received. Thank you!" : "The buyer has paid."}
        </p>
      )}
      <OrderDetails order={order} />
      {order.status === "AWAITING_PAYMENT" &&
        (order.viewer === "buyer" ? (
          <div className="space-y-2 border border-line bg-white p-3">
            <p>You won this auction. Pay {formatEur(order.amountCents)} by card before the time above, or the item may be offered to the next bidder.</p>
            <PayButton action={startPaymentAction} label={`Pay ${formatEur(order.amountCents)}`} orderId={order.id} />
          </div>
        ) : (
          <p className="border border-line bg-white p-3">Waiting for the buyer to pay.</p>
        ))}
    </div>
  );
}

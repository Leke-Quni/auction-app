import { formatEur, type OrderView, type ShippingAddress } from "@auction/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { PickupAddressEditor } from "@/app/sell/pickup-address-editor";
import { startPaymentAction } from "../actions";
import { OrderDetails } from "../order-details";
import { PayButton } from "../pay-button";

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { id } = await params;
  if (!(await auth())) redirect("/sign-in");
  const { paid } = await searchParams;
  // Coming back from the payment provider: check with it, then reload the order without the flag so a refresh does not
  // check again. Someone who is not the buyer (403) has nothing to confirm.
  let confirmFailed = false;
  if (paid) {
    const confirmed = await authedApiFetch(`/orders/${id}/confirm`, { method: "POST" });
    if (confirmed.ok || confirmed.status === 403 || confirmed.status === 404) redirect(`/orders/${id}`);
    confirmFailed = true;
  }
  const res = await authedApiFetch(`/orders/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /orders/${id} failed: ${res.status}`);
  const order: OrderView = await res.json();

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="border border-line bg-white p-2 text-lg font-bold">{order.viewer === "buyer" ? "Your purchase" : "Your sale"}</h1>
      {confirmFailed && (
        <p role="alert" className="border border-line bg-white p-2 font-bold">
          We could not check your payment just now. Reload this page in a moment; if you paid, the order will show as paid.
        </p>
      )}
      {order.status === "PAID" && (
        <p role="status" className="border border-time-ok bg-white p-2 font-bold text-time-ok">
          {order.viewer === "buyer" ? "Payment received. Thank you!" : "The buyer has paid."}
        </p>
      )}
      <OrderDetails order={order} />
      {order.viewer === "seller" && (order.status === "AWAITING_PAYMENT" || order.status === "PAID") && (
        <PickupAddressEditor listingId={order.listingId} address={(order.pickupAddress as ShippingAddress | undefined) ?? null} />
      )}
      {order.status === "AWAITING_PAYMENT" &&
        (order.viewer === "buyer" ? (
          order.shipping && order.totalCents !== null ? (
            <div className="space-y-2 border border-line bg-white p-3">
              <p>
                You won this auction. Pay {formatEur(order.totalCents)} (price and delivery) by card before the time above, or the item may be offered to the next bidder.
              </p>
              <PayButton action={startPaymentAction} label={`Pay ${formatEur(order.totalCents)}`} orderId={order.id} />
              <Link href={`/orders/${order.id}/shipping`} className="text-brand underline">
                Change the delivery
              </Link>
            </div>
          ) : (
            <div className="space-y-2 border border-line bg-white p-3">
              <p>You won this auction. Choose where to deliver it, then pay by the time above, or the item may be offered to the next bidder.</p>
              <Link href={`/orders/${order.id}/shipping`} className="inline-block bg-brand px-4 py-2 font-bold text-white hover:bg-brand-dark">
                Pay now: delivery and payment
              </Link>
            </div>
          )
        ) : (
          <p className="border border-line bg-white p-3">Waiting for the buyer to pay.</p>
        ))}
    </div>
  );
}

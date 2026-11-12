import { formatEur, type OrderView, type ShippingAddress, type ShippingOption } from "@auction/shared";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { ShippingForm } from "./shipping-form";

// Before paying: where to deliver, and which of the shipping service's options to use.
export default async function ShippingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await auth())) redirect("/sign-in");
  // The order, its delivery options and the account's saved address do not depend on each other, so they are asked for together.
  const [res, optionsRes, pickupRes] = await Promise.all([
    authedApiFetch(`/orders/${id}`),
    authedApiFetch(`/orders/${id}/shipping/options`),
    authedApiFetch("/me/pickup-address").catch(() => null),
  ]);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /orders/${id} failed: ${res.status}`);
  const order: OrderView = await res.json();
  if (order.viewer !== "buyer" || order.status !== "AWAITING_PAYMENT" || order.sellerSuspended) redirect(`/orders/${id}`);
  if (!optionsRes.ok) throw new Error(`API /orders/${id}/shipping/options failed: ${optionsRes.status}`);
  const options: ShippingOption[] = await optionsRes.json();
  // Until the buyer has chosen an address for this order, start from the address saved in their account. Every field can be changed here.
  const accountAddress = pickupRes?.ok ? (((await pickupRes.json()) as { pickupAddress: ShippingAddress | null }).pickupAddress ?? null) : null;

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="border border-line bg-surface p-2 text-lg font-bold">Delivery for {order.title}</h1>
      <p className="border border-line bg-surface p-2">
        Price {formatEur(order.amountCents)} plus delivery. Our carrier collects it from the seller and brings it to you. Delivery is a share of the price plus the option you choose.
      </p>
      <ShippingForm orderId={order.id} amountCents={order.amountCents} options={options} saved={(order.shipping?.address as ShippingAddress | undefined) ?? accountAddress} savedOptionId={order.shipping?.optionId ?? null} savedTrackingEmails={order.trackingEmails ?? false} />
    </div>
  );
}

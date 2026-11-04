import { formatEur, type OrderView, type ShippingAddress, type ShippingOption } from "@auction/shared";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { ShippingForm } from "./shipping-form";

// Before paying: where to deliver, and which of the shipping service's options to use.
export default async function ShippingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch(`/orders/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /orders/${id} failed: ${res.status}`);
  const order: OrderView = await res.json();
  if (order.viewer !== "buyer" || order.status !== "AWAITING_PAYMENT") redirect(`/orders/${id}`);

  const optionsRes = await authedApiFetch(`/orders/${id}/shipping/options`);
  if (!optionsRes.ok) throw new Error(`API /orders/${id}/shipping/options failed: ${optionsRes.status}`);
  const options: ShippingOption[] = await optionsRes.json();

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="border border-line bg-white p-2 text-lg font-bold">Delivery for {order.title}</h1>
      <p className="border border-line bg-white p-2">
        Price {formatEur(order.amountCents)} plus delivery. Our carrier collects it from the seller and brings it to you. Delivery is a share of the price plus the option you choose.
      </p>
      <ShippingForm orderId={order.id} amountCents={order.amountCents} options={options} saved={(order.shipping?.address as ShippingAddress | undefined) ?? null} savedOptionId={order.shipping?.optionId ?? null} />
    </div>
  );
}

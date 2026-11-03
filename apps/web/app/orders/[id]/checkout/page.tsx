import { formatEur, type OrderView } from "@auction/shared";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { payWithTestCardAction } from "../../actions";
import { PayButton } from "../../pay-button";

// The stand-in for a payment provider's page, used while the app runs without a payment account. No money moves.
export default async function TestCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch(`/orders/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /orders/${id} failed: ${res.status}`);
  const order: OrderView = await res.json();
  if (order.viewer !== "buyer" || order.status !== "AWAITING_PAYMENT") redirect(`/orders/${id}`);

  return (
    <div className="mx-auto max-w-sm space-y-3 border border-line bg-white p-4">
      <h1 className="text-lg font-bold">Test checkout</h1>
      <p className="text-muted">This is a test payment page. No real money moves and no card is needed.</p>
      <p>
        {order.title}: <b>{formatEur(order.amountCents)}</b>
      </p>
      <PayButton action={payWithTestCardAction} label="Pay with test card" orderId={order.id} />
    </div>
  );
}

"use server";

import { ORDER_REFUSAL_MESSAGES, ORDER_REFUSALS, type OrderRefusal } from "@auction/shared";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

export interface OrderActionState {
  error?: string;
}

const SOMETHING_WENT_WRONG = "Something went wrong. Try again.";

async function failure(res: Response): Promise<string> {
  if (res.status === 401) return "Your session has expired. Sign in again.";
  const body = await res.json().catch(() => null);
  const code: unknown = body?.code;
  if ((ORDER_REFUSALS as readonly string[]).includes(code as string)) return ORDER_REFUSAL_MESSAGES[code as OrderRefusal];
  return SOMETHING_WENT_WRONG;
}

// Sends the buyer to the payment provider's checkout for this order.
export async function startPaymentAction(orderId: string): Promise<OrderActionState> {
  if (!(await auth())) return { error: "Sign in to pay." };
  let res: Response;
  try {
    res = await authedApiFetch(`/orders/${orderId}/checkout`, { method: "POST" });
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  if (!res.ok) return { error: await failure(res) };
  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

// The test checkout page: stands in for the buyer's card going through, then asks the order to check with the provider.
export async function payWithTestCardAction(orderId: string): Promise<OrderActionState> {
  if (!(await auth())) return { error: "Sign in to pay." };
  try {
    const paid = await authedApiFetch(`/orders/${orderId}/test-pay`, { method: "POST" });
    if (!paid.ok) return { error: await failure(paid) };
    const confirmed = await authedApiFetch(`/orders/${orderId}/confirm`, { method: "POST" });
    if (!confirmed.ok) return { error: await failure(confirmed) };
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  redirect(`/orders/${orderId}`);
}

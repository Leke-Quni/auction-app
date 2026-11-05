"use server";

import { ORDER_REFUSAL_MESSAGES, ORDER_REFUSALS, type OrderRefusal, type ShippingAddress } from "@auction/shared";
import { apiErrorMessage } from "@/lib/api-error";
import { revalidatePath } from "next/cache";
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
  if (res.status === 400) return await apiErrorMessage(new Response(JSON.stringify(body)), SOMETHING_WENT_WRONG);
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

// The seller hands a paid order to the carrier. The order page reloads with the new status.
export async function markShippedAction(orderId: string): Promise<OrderActionState> {
  if (!(await auth())) return { error: "Sign in to continue." };
  try {
    const res = await authedApiFetch(`/orders/${orderId}/ship`, { method: "POST" });
    if (!res.ok) return { error: await failure(res) };
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Saves the address and the chosen option, then goes straight to the payment provider's checkout for the new total.
export async function saveShippingAndPayAction(orderId: string, address: ShippingAddress, optionId: string, trackingEmails: boolean): Promise<OrderActionState> {
  if (!(await auth())) return { error: "Sign in to pay." };
  let res: Response;
  try {
    const saved = await authedApiFetch(`/orders/${orderId}/shipping`, { method: "PUT", body: JSON.stringify({ address, optionId, trackingEmails }) });
    if (!saved.ok) return { error: await failure(saved) };
    res = await authedApiFetch(`/orders/${orderId}/checkout`, { method: "POST" });
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  if (!res.ok) return { error: await failure(res) };
  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

// Sends the seller to the payment provider's page to set up (or finish setting up) the account their payouts go to.
// The order id is unused; it is only there so the function fits PayButton, which passes one to every action.
export async function startPayoutOnboardingAction(orderId?: string): Promise<OrderActionState> {
  void orderId;
  if (!(await auth())) return { error: "Sign in to continue." };
  let res: Response;
  try {
    res = await authedApiFetch("/me/payout-account/onboarding", { method: "POST" });
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  if (!res.ok) return { error: "We could not open the payment setup page. Try again in a moment." };
  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

// The buyer rates the seller after delivery. The order page reloads showing the rating in place of the form.
export async function rateSellerAction(orderId: string, stars: number, comment: string): Promise<OrderActionState> {
  if (!(await auth())) return { error: "Sign in to rate the seller." };
  try {
    const res = await authedApiFetch(`/orders/${orderId}/rating`, { method: "POST", body: JSON.stringify({ stars, comment }) });
    if (!res.ok) return { error: await failure(res) };
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  revalidatePath(`/orders/${orderId}`);
  return {};
}

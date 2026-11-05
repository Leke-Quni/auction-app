"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export interface RemoveState {
  error?: string;
}

export async function removeListingAction(_: RemoveState, formData: FormData): Promise<RemoveState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Give a reason. The seller sees it." };
  if (reason.length > 500) return { error: "The reason is at most 500 characters." };
  const res = await adminApiFetch(`/admin/listings/${encodeURIComponent(id)}/remove`, { method: "POST", body: JSON.stringify({ reason }) });
  if (res.status === 409) {
    const body = await res.json().catch(() => null);
    revalidatePath(`/listings/${id}`);
    return { error: body?.code === "NOT_PUBLISHED" ? "Only a published listing can be removed." : "This auction has already ended." };
  }
  if (res.status === 404) return { error: "That listing no longer exists." };
  if (!res.ok) return { error: "Something went wrong. Try again." };
  redirect(`/listings/${id}`);
}

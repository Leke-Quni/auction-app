"use server";

import { revalidatePath } from "next/cache";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export async function handleSupportAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const res = await adminApiFetch(`/admin/support/${encodeURIComponent(id)}/handle`, { method: "POST" });
  if (!res.ok && res.status !== 404) throw new Error(`Could not close the request: ${res.status}`);
  revalidatePath("/support");
}

// Grants an appeal: clears the strike, then closes the request.
export async function clearStrikeAndCloseAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const strikeId = String(formData.get("strikeId") ?? "");
  if (!id || !strikeId) return;
  const cleared = await adminApiFetch(`/admin/strikes/${encodeURIComponent(strikeId)}`, { method: "DELETE" });
  if (!cleared.ok && cleared.status !== 404) throw new Error(`Could not clear the strike: ${cleared.status}`);
  const res = await adminApiFetch(`/admin/support/${encodeURIComponent(id)}/handle`, { method: "POST" });
  if (!res.ok && res.status !== 404) throw new Error(`Could not close the request: ${res.status}`);
  revalidatePath("/support");
}

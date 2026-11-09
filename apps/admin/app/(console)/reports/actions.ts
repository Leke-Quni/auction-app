"use server";

import { revalidatePath } from "next/cache";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export async function handleReportAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const res = await adminApiFetch(`/admin/reports/${encodeURIComponent(id)}/handle`, { method: "POST" });
  if (!res.ok && res.status !== 404) throw new Error(`Could not mark the report handled: ${res.status}`);
  revalidatePath("/reports");
}

export async function removePostAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const res = await adminApiFetch(`/admin/reports/${encodeURIComponent(id)}/remove-post`, { method: "POST" });
  if (!res.ok && res.status !== 404) throw new Error(`Could not remove the post: ${res.status}`);
  revalidatePath("/reports");
}

export async function strikeAuthorAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const res = await adminApiFetch(`/admin/reports/${encodeURIComponent(id)}/strike-author`, { method: "POST" });
  if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(`Could not strike the author: ${res.status}`);
  revalidatePath("/reports");
}

export interface StrikeRemoveResult {
  error?: string;
}

// Strike first, then take the post down: the strike is refused when the post changed or the author is an admin or gone, and
// then nothing is removed, and the admin is told why. The report row stays after the strike closes it, so the removal can still
// find the post by it.
export async function strikeAndRemoveAction(_: StrikeRemoveResult, formData: FormData): Promise<StrikeRemoveResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return {};
  const strike = await adminApiFetch(`/admin/reports/${encodeURIComponent(id)}/strike-author`, { method: "POST" });
  if (!strike.ok) {
    if (strike.status === 404) {
      revalidatePath("/reports");
      return { error: "That report no longer exists. Reload the page." };
    }
    if (strike.status === 409) {
      const body = (await strike.json().catch(() => null)) as { message?: string } | null;
      revalidatePath("/reports");
      return { error: `${body?.message ?? "The strike was refused."} Nothing was removed.` };
    }
    throw new Error(`Could not strike the author: ${strike.status}`);
  }
  const removal = await adminApiFetch(`/admin/reports/${encodeURIComponent(id)}/remove-post`, { method: "POST" });
  if (!removal.ok && removal.status !== 404) throw new Error(`The strike was given, but the post could not be removed: ${removal.status}`);
  revalidatePath("/reports");
  return {};
}

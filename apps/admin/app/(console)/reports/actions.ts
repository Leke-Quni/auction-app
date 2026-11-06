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

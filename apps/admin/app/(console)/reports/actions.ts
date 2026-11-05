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

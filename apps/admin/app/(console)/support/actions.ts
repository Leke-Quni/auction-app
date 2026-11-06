"use server";

import { revalidatePath } from "next/cache";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export interface ActionResult {
  error?: string;
}

async function failure(res: Response, what: string): Promise<ActionResult> {
  if (res.status === 404) return { error: "That request no longer exists. Reload the page." };
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) return { error: body.message };
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return { error: `${what} (the API answered ${res.status}). Try again.` };
}

export async function handleSupportAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return {};
  const res = await adminApiFetch(`/admin/support/${encodeURIComponent(id)}/handle`, { method: "POST" });
  if (!res.ok) return failure(res, "Could not close the request");
  revalidatePath("/support");
  return {};
}

// Grants an appeal: one API call clears the strike and closes the request together, so a failure cannot leave one done without the other.
export async function clearStrikeAndCloseAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return {};
  const res = await adminApiFetch(`/admin/support/${encodeURIComponent(id)}/grant`, { method: "POST" });
  if (!res.ok) return failure(res, "Could not clear the strike");
  const { changed } = (await res.json()) as { changed: boolean };
  revalidatePath("/support");
  return changed ? {} : { error: "Another admin already closed this request, so nothing was changed." };
}

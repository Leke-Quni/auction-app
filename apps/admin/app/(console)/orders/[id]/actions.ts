"use server";

import { ORDER_NOTE_MAX } from "@auction/shared";
import { revalidatePath } from "next/cache";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export interface NoteState {
  error?: string;
}

export async function addOrderNoteAction(_: NoteState, formData: FormData): Promise<NoteState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Write a note." };
  if (body.length > ORDER_NOTE_MAX) return { error: `A note is at most ${ORDER_NOTE_MAX} characters.` };
  const res = await adminApiFetch(`/admin/orders/${encodeURIComponent(id)}/notes`, { method: "POST", body: JSON.stringify({ body }) });
  if (res.status === 404) return { error: "That order no longer exists." };
  if (!res.ok) return { error: "Something went wrong. Try again." };
  revalidatePath(`/orders/${id}`);
  return {};
}

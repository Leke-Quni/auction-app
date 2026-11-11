"use server";

import { ORDER_NOTE_MAX } from "@auction/shared";
import { revalidatePath } from "next/cache";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export interface NoteState {
  error?: string;
}

export interface ResendState {
  error?: string;
  ok?: string;
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

const RESEND_MESSAGES: Record<string, string> = {
  NOT_RESENDABLE: "That email no longer applies to this order. Reload the page.",
  ALREADY_QUEUED: "That email is already waiting to be sent.",
};

export async function resendOrderEmailAction(_: ResendState, formData: FormData): Promise<ResendState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const res = await adminApiFetch(`/admin/orders/${encodeURIComponent(id)}/resend`, { method: "POST", body: JSON.stringify({ kind }) });
  revalidatePath(`/orders/${id}`);
  if (res.ok) return { ok: "Sent again. It goes out within a moment." };
  if (res.status === 404) return { error: "That order no longer exists." };
  const body = await res.json().catch(() => null);
  return { error: body?.message ?? RESEND_MESSAGES[body?.code] ?? "Something went wrong. Try again." };
}

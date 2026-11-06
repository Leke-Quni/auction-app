"use server";

import { supportRequestSchema } from "@auction/shared";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

export interface SupportState {
  error?: string;
  ok?: string;
}

// Sends the support form. The API checks the strike belongs to the person and limits how many a day.
export async function sendSupportAction(_: SupportState, formData: FormData): Promise<SupportState> {
  if (!(await auth())) return { error: "Sign in to contact support." };
  const raw = Object.fromEntries(formData);
  const parsed = supportRequestSchema.safeParse({ kind: raw.kind, strikeId: raw.kind === "STRIKE_APPEAL" ? raw.strikeId || undefined : undefined, message: raw.message });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  let res: Response;
  try {
    res = await authedApiFetch("/support", { method: "POST", body: JSON.stringify(parsed.data) });
  } catch {
    return { error: "Could not reach the server. Try again." };
  }
  if (res.status === 404 || res.status === 409 || res.status === 429) return { error: await apiErrorMessage(res) };
  if (!res.ok) return { error: "Something went wrong. Try again." };
  return { ok: parsed.data.kind === "STRIKE_APPEAL" ? "Your appeal was sent. We will answer by email." : "Your message was sent. We will answer by email." };
}

"use server";

import { changePasswordSchema, updateProfileSchema } from "@auction/shared";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { updateSession } from "@/auth";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export interface SettingsState {
  error?: string;
  ok?: string;
}

const UNREACHABLE = "Could not reach the server. Try again.";
const SOMETHING_WENT_WRONG = "Something went wrong. Try again.";
const firstIssue = (error: ZodError) => error.issues[0]?.message ?? "Check the form and try again.";

export async function updateNameAction(_: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireAdmin();
  const parsed = updateProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await adminApiFetch("/me", { method: "PATCH", body: JSON.stringify(parsed.data) }).catch(() => null);
  if (!res) return { error: UNREACHABLE };
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  revalidatePath("/account", "layout");
  return { ok: "Name updated." };
}

export async function changePasswordAction(_: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireAdmin();
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await adminApiFetch("/me/password", { method: "POST", body: JSON.stringify(parsed.data) }).catch(() => null);
  if (!res) return { error: UNREACHABLE };
  if (res.status === 403) return { error: "Your current password is incorrect." };
  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    return { error: typeof body?.message === "string" ? body.message : "Too many attempts. Wait a moment." };
  }
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  // Every other browser is signed out; this one takes the new session number and stays signed in.
  const { sessionVersion } = await res.json();
  await updateSession({ sessionVersion });
  return { ok: "Password changed. Your other sessions were signed out." };
}

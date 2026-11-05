"use server";

import { revalidatePath } from "next/cache";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export interface UserActionState {
  error?: string;
}

const MESSAGES: Record<string, string> = {
  CANNOT_BAN_ADMIN: "An admin cannot be banned. Remove their admin role first.",
  ALREADY_BANNED: "This account is already banned.",
  NOT_BANNED: "This account is not banned.",
};

async function run(id: string, path: string, init: RequestInit): Promise<UserActionState> {
  await requireAdmin();
  const res = await adminApiFetch(path, init);
  revalidatePath(`/users/${id}`);
  if (res.ok) return {};
  if (res.status === 404) return { error: "That account or strike no longer exists." };
  const body = await res.json().catch(() => null);
  return { error: MESSAGES[body?.code] ?? "Something went wrong. Try again." };
}

export async function banUserAction(_: UserActionState, formData: FormData): Promise<UserActionState> {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Give a reason." };
  if (reason.length > 500) return { error: "The reason is at most 500 characters." };
  return run(id, `/admin/users/${encodeURIComponent(id)}/ban`, { method: "POST", body: JSON.stringify({ reason }) });
}

export async function unbanUserAction(_: UserActionState, formData: FormData): Promise<UserActionState> {
  const id = String(formData.get("id") ?? "");
  return run(id, `/admin/users/${encodeURIComponent(id)}/unban`, { method: "POST" });
}

export async function clearStrikeAction(_: UserActionState, formData: FormData): Promise<UserActionState> {
  const id = String(formData.get("id") ?? "");
  const strikeId = String(formData.get("strikeId") ?? "");
  return run(id, `/admin/strikes/${encodeURIComponent(strikeId)}`, { method: "DELETE" });
}

"use server";

import { loginCodeSchema, signInSchema } from "@auction/shared";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { apiFetch } from "@/lib/api";

export interface FormState {
  error?: string;
}

// Step 1: the password. The API emails a 6-digit code when it is right.
export async function signInAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  const res = await apiFetch("/auth/login/start", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 401) return { error: "Invalid email or password." };
  if (res.status === 403) return { error: "This account has been suspended." };
  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    return { error: typeof body?.message === "string" ? body.message : "Too many attempts. Wait a moment." };
  }
  if (!res.ok) return { error: "Something went wrong. Try again." };
  redirect(`/sign-in/code?email=${encodeURIComponent(parsed.data.email)}`);
}

// Step 2: the code. Anyone who is not an admin is refused here, with the same message as a wrong code.
export async function verifyCodeAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginCodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter the 6-digit code from your email." };
  try {
    await signIn("credentials", { ...parsed.data, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "That code is wrong or has expired, or this account is not an admin." };
    throw error;
  }
  return {};
}

// "Send a new code" on the code page. The answer is the same whether or not a code went out, so the message is worded to match.
export async function resendCodeAction(email: string): Promise<{ ok?: string; error?: string }> {
  const res = await apiFetch("/auth/login/resend", { method: "POST", body: JSON.stringify({ email }) });
  if (!res.ok) return { error: "Something went wrong. Try again." };
  return { ok: "If you signed in a moment ago, a new code is on its way. It replaces the old one." };
}

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

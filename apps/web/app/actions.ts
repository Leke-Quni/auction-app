"use server";

import { signInSchema, signUpSchema } from "@auction/shared";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { apiFetch } from "@/lib/api";

export interface FormState {
  error?: string;
}

export async function signUpAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a name, a valid email, and a password of at least 8 characters." };
  const res = await apiFetch("/auth/signup", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 409) return { error: "That email is already registered." };
  if (!res.ok) return { error: "Something went wrong. Try again." };
  redirect("/sign-up/check-email");
}

export async function signInAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  try {
    await signIn("credentials", { ...parsed.data, redirectTo: "/account" });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error:
          error.cause?.err?.message === "email_not_verified" || (error as { code?: string }).code === "email_not_verified"
            ? "Verify your email first. Check your inbox for the link."
            : "Invalid email or password.",
      };
    }
    throw error;
  }
  return {};
}

export async function verifyEmailAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const res = await apiFetch("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
  redirect(`/verify-email?status=${res.ok ? "ok" : "invalid"}`);
}

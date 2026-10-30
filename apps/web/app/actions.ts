"use server";

import {
  changePasswordSchema,
  confirmEmailChangeSchema,
  forgotPasswordSchema,
  loginCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  startEmailChangeSchema,
  updateProfileSchema,
  updateUsernameSchema,
} from "@auction/shared";
import type { ZodError } from "zod";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signIn, unstable_update } from "@/auth";
import { apiFetch, authedApiFetch } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

export interface FormState {
  error?: string;
  ok?: string;
}

const SOMETHING_WENT_WRONG = "Something went wrong. Try again.";

// The shared schemas carry user-facing messages, so show the first one.
const firstIssue = (error: ZodError) => error.issues[0]?.message ?? "Check the form and try again.";

async function conflictMessage(res: Response) {
  const { code } = await res.json().catch(() => ({ code: undefined }));
  return code === "USERNAME_TAKEN" ? "That username is already taken." : "That email is already registered.";
}

export async function signUpAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await apiFetch("/auth/signup", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 409) return { error: await conflictMessage(res) };
  if (res.status === 422) return { error: await apiErrorMessage(res) };
  if (!res.ok) return { error: "Something went wrong. Try again." };
  redirect(`/sign-in/code?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signInAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  const res = await apiFetch("/auth/login/start", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 401) return { error: "Invalid email or password." };
  if (res.status === 422) return { error: await apiErrorMessage(res) };
  if (!res.ok) return { error: "Something went wrong. Try again." };
  redirect(`/sign-in/code?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function verifyCodeAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginCodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter the 6-digit code from your email." };
  try {
    await signIn("credentials", { ...parsed.data, redirectTo: "/account" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "That code is invalid or has expired. Sign in again to get a new one." };
    throw error;
  }
  return {};
}

export async function forgotPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email." };
  const res = await apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify(parsed.data) });
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  return { ok: "If that email has an account, we've sent a link to reset the password." };
}

export async function resetPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 400) return { error: "This link is invalid or has expired. Request a new one." };
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  redirect("/sign-in?reset=1");
}

export async function updateProfileAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = updateProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await authedApiFetch("/me", { method: "PATCH", body: JSON.stringify(parsed.data) });
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  revalidatePath("/account", "layout");
  return { ok: "Name updated." };
}

export async function updateUsernameAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = updateUsernameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await authedApiFetch("/me/username", { method: "PATCH", body: JSON.stringify(parsed.data) });
  if (res.status === 409) return { error: "That username is already taken." };
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  const { username } = await res.json();
  await unstable_update({ user: { name: username } });
  revalidatePath("/", "layout");
  return { ok: `Username changed to ${username}.` };
}

export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await authedApiFetch("/me/password", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 403) return { error: "Your current password is incorrect." };
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  return { ok: "Password changed." };
}

export async function startEmailChangeAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = startEmailChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const res = await authedApiFetch("/me/email/start", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 403) return { error: "Your password is incorrect." };
  if (res.status === 409) return { error: "That email is already registered." };
  if (res.status === 400) return { error: "That is already your email." };
  if (res.status === 422) return { error: await apiErrorMessage(res) };
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  redirect(`/account/email?pending=${encodeURIComponent(parsed.data.newEmail)}`);
}

export async function confirmEmailChangeAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = confirmEmailChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter the 6-digit code." };
  const res = await authedApiFetch("/me/email/confirm", { method: "POST", body: JSON.stringify(parsed.data) });
  if (res.status === 401) return { error: "That code is invalid or has expired." };
  if (res.status === 409) return { error: "That email is already registered." };
  if (!res.ok) return { error: SOMETHING_WENT_WRONG };
  const { email } = await res.json();
  await unstable_update({ user: { email } });
  revalidatePath("/", "layout");
  redirect("/account/settings");
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "./actions";

const input = "w-full border border-[#888] bg-white p-2 text-base";

export function AuthForm({
  action,
  title,
  submit,
  forgot,
  footer,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  title: string;
  submit: string;
  forgot?: boolean;
  footer: { text: string; href: string; label: string };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="mx-auto max-w-sm space-y-3 border border-line bg-white p-4">
      <h1 className="text-lg font-bold">{title}</h1>
      <input name="email" type="email" placeholder="Email" autoComplete="email" required className={input} />
      <input
        name="password"
        type="password"
        placeholder="Password"
        autoComplete="current-password"
        required
        className={input}
      />
      {forgot && (
        <p>
          <Link href="/forgot-password" className="text-brand underline">
            Forgot your password?
          </Link>
        </p>
      )}
      {state.error && <p className="text-urgent">{state.error}</p>}
      <button disabled={pending} className="w-full cursor-pointer bg-brand p-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
        {pending ? "..." : submit}
      </button>
      <p className="text-muted">
        {footer.text}{" "}
        <Link href={footer.href} className="text-brand underline">
          {footer.label}
        </Link>
      </p>
    </form>
  );
}

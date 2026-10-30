"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyCodeAction } from "./actions";

export function CodeForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(verifyCodeAction, {});
  return (
    <form action={formAction} className="mx-auto max-w-sm space-y-3 border border-line bg-white p-4">
      <h1 className="text-lg font-bold">Check your email</h1>
      <p className="text-muted">
        We sent a 6-digit code to <b>{email}</b>. It expires in 10 minutes.
      </p>
      <input type="hidden" name="email" value={email} />
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="123456"
        required
        autoFocus
        className="w-full border border-[#888] bg-white p-2 text-center text-xl tracking-[0.5em]"
      />
      {state.error && <p className="text-urgent">{state.error}</p>}
      <button disabled={pending} className="w-full cursor-pointer bg-brand p-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
        {pending ? "..." : "Verify and sign in"}
      </button>
      <p className="text-muted">
        <Link href="/sign-in" className="text-brand underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

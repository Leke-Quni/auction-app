"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyCodeAction } from "../../actions";
import { ResendCode } from "./resend-code";

export function CodeForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(verifyCodeAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <p className="text-muted">
        We sent a 6-digit code to <b className="text-ink">{email}</b>. It expires in 10 minutes.
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
        aria-label="6-digit code"
        className="w-full rounded border border-line bg-white p-2 text-center text-xl tracking-[0.5em] outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="w-full cursor-pointer rounded bg-accent px-3 py-2 font-semibold text-white hover:bg-accent-dark disabled:opacity-60">
        {pending ? "Please wait..." : "Verify and sign in"}
      </button>
      <ResendCode email={email} />
      <p>
        <Link href="/sign-in" className="text-accent underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

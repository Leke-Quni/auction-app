"use client";

import { useActionState } from "react";
import { sendSuspendedSupportAction } from "../support/actions";
import type { SupportState } from "../support/actions";

// A suspended account cannot sign in, so this form asks for the account's email instead.
export function SuspendedSupportForm() {
  const [state, action, pending] = useActionState<SupportState, FormData>(sendSuspendedSupportAction, {});
  return (
    <form action={action} className="space-y-2 border-t border-line pt-3">
      <h2 className="text-sm font-bold">Contact support</h2>
      <label className="block">
        <span className="text-xs text-muted">Email of your account</span>
        <input name="email" type="email" required autoComplete="email" className="mt-1 w-full border border-field bg-surface p-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Your message</span>
        <textarea name="message" required maxLength={2000} rows={5} className="mt-1 w-full border border-field bg-surface p-1.5 text-sm" />
      </label>
      {state.error && <p className="text-urgent">{state.error}</p>}
      {state.ok && <p className="text-brand">{state.ok}</p>}
      <button disabled={pending} className="cursor-pointer bg-brand px-4 py-2 font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Sending..." : "Send"}
      </button>
    </form>
  );
}

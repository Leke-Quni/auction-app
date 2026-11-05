"use client";

import { useActionState } from "react";
import { signInAction } from "../actions";

const field = "w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function SignInForm({ denied }: { denied: boolean }) {
  const [state, formAction, pending] = useActionState(signInAction, {});
  return (
    <form action={formAction} className="space-y-3">
      {denied && (
        <p role="alert" className="rounded border border-danger bg-danger-soft p-2 text-danger">
          That account is not allowed to use the admin app.
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-muted">Email</span>
        <input name="email" type="email" autoComplete="email" required className={field} />
      </label>
      <label className="block space-y-1">
        <span className="text-muted">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={field} />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="w-full cursor-pointer rounded bg-accent px-3 py-2 font-semibold text-white hover:bg-accent-dark disabled:opacity-60">
        {pending ? "Please wait..." : "Continue"}
      </button>
    </form>
  );
}

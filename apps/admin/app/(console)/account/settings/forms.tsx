"use client";

import { useActionState } from "react";
import { changePasswordAction, updateNameAction, type SettingsState } from "./actions";

const field = "mt-1 w-full rounded border border-line bg-panel p-2";
const button = "cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark disabled:opacity-60";

function Result({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-danger">
        {state.error}
      </p>
    );
  }
  return state.ok ? <p role="status" className="text-ok">{state.ok}</p> : null;
}

export function NameForm({ firstName, lastName }: { firstName: string; lastName: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateNameAction, {});
  return (
    <form action={action} className="space-y-2 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-muted">First name</span>
          <input name="firstName" defaultValue={firstName} required autoComplete="given-name" className={field} />
        </label>
        <label className="block">
          <span className="text-muted">Last name</span>
          <input name="lastName" defaultValue={lastName} required autoComplete="family-name" className={field} />
        </label>
      </div>
      <Result state={state} />
      <button disabled={pending} className={button}>
        {pending ? "Saving..." : "Save name"}
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-2 p-3">
      <label className="block">
        <span className="text-muted">Current password</span>
        <input name="currentPassword" type="password" required autoComplete="current-password" className={field} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-muted">New password</span>
          <input name="newPassword" type="password" required autoComplete="new-password" className={field} />
        </label>
        <label className="block">
          <span className="text-muted">Confirm new password</span>
          <input name="confirmPassword" type="password" required autoComplete="new-password" className={field} />
        </label>
      </div>
      <Result state={state} />
      <button disabled={pending} className={button}>
        {pending ? "Saving..." : "Change password"}
      </button>
    </form>
  );
}

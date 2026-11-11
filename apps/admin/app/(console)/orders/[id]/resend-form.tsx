"use client";

import { useActionState } from "react";
import { resendOrderEmailAction, type ResendState } from "./actions";

export function ResendButton({ id, kind, label, recipient }: { id: string; kind: string; label: string; recipient: string }) {
  const [state, action, pending] = useActionState<ResendState, FormData>(resendOrderEmailAction, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Send this email again to ${recipient}?\n\n${label}`)) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-2 border-t border-line p-2 first:border-t-0"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <span className="min-w-0 flex-1">
        {label} <span className="text-muted">({recipient})</span>
      </span>
      {state.ok && <span className="text-ok">{state.ok}</span>}
      {state.error && (
        <span role="alert" className="text-danger">
          {state.error}
        </span>
      )}
      <button disabled={pending} className="cursor-pointer rounded border border-line bg-panel px-3 py-1 font-semibold hover:border-accent disabled:opacity-60">
        {pending ? "Sending..." : "Send again"}
      </button>
    </form>
  );
}

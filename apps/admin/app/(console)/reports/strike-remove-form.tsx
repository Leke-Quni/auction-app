"use client";

import { useActionState } from "react";
import type { StrikeRemoveResult } from "./actions";

export function StrikeRemoveForm({ action, id, username, what }: { action: (state: StrikeRemoveResult, formData: FormData) => Promise<StrikeRemoveResult>; id: string; username: string; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Give @${username} a strike and remove this ${what}? The reports about it are closed. This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} title={`Strike @${username} and remove this ${what}`} className="cursor-pointer rounded bg-danger px-2 py-0.5 font-semibold text-white disabled:opacity-60">Strike and remove {what}</button>
      {state.error && <p role="alert" className="mt-1 max-w-xs text-red-700">{state.error}</p>}
    </form>
  );
}

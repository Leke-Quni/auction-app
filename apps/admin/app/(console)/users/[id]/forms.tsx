"use client";

import { useActionState } from "react";
import { banUserAction, clearStrikeAction, unbanUserAction, type UserActionState } from "./actions";

const FormError = ({ state }: { state: UserActionState }) =>
  state.error ? (
    <p role="alert" className="text-danger">
      {state.error}
    </p>
  ) : null;

export function BanForm({ id, username }: { id: string; username: string }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(banUserAction, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Ban @${username}? They are signed out of everything at once and cannot use the site. Their listings, bids and orders stay as they are.`)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-muted">Reason</span>
        <textarea name="reason" required maxLength={500} rows={3} className="mt-1 w-full rounded border border-line bg-panel p-2" />
      </label>
      <FormError state={state} />
      <button disabled={pending} className="cursor-pointer rounded bg-danger px-3 py-1 font-semibold text-white disabled:opacity-60">
        {pending ? "Banning..." : "Ban account"}
      </button>
    </form>
  );
}

export function UnbanForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(unbanUserAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <FormError state={state} />
      <button disabled={pending} className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-white hover:bg-accent-dark disabled:opacity-60">
        {pending ? "Restoring..." : "Restore account"}
      </button>
    </form>
  );
}

export function ClearStrikeForm({ id, strikeId }: { id: string; strikeId: string }) {
  const [state, action, pending] = useActionState<UserActionState, FormData>(clearStrikeAction, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Clear this strike?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="strikeId" value={strikeId} />
      <button disabled={pending} className="cursor-pointer rounded border border-line bg-panel px-2 py-0.5 hover:bg-page disabled:opacity-60">
        Clear
      </button>
      <FormError state={state} />
    </form>
  );
}

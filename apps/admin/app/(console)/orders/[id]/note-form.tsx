"use client";

import { ORDER_NOTE_MAX } from "@auction/shared";
import { useActionState } from "react";
import { addOrderNoteAction, type NoteState } from "./actions";

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<NoteState, FormData>(addOrderNoteAction, {});
  return (
    <form action={action} className="space-y-2 border-t border-line p-2">
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-muted">Add a note (only admins see it, and it cannot be edited or deleted)</span>
        <textarea name="body" required maxLength={ORDER_NOTE_MAX} rows={3} className="mt-1 w-full rounded border border-line bg-panel p-2" />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark disabled:opacity-60">
        {pending ? "Saving..." : "Add note"}
      </button>
    </form>
  );
}

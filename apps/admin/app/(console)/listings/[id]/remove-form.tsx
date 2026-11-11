"use client";

import { useActionState } from "react";
import { removeListingAction, type RemoveState } from "./actions";

export function RemoveForm({ id, bidCount }: { id: string; bidCount: number }) {
  const [state, action, pending] = useActionState<RemoveState, FormData>(removeListingAction, {});
  const warning = bidCount > 0 ? `Remove this listing? It ends now with no sale. All ${bidCount} bids are void and every bidder is emailed. This cannot be undone.` : "Remove this listing? It ends now and cannot be listed again.";
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(warning)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-muted">Reason (the seller sees it)</span>
        <textarea name="reason" required maxLength={500} rows={3} className="mt-1 w-full rounded border border-line bg-panel p-2" />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="cursor-pointer rounded bg-danger px-3 py-1 font-semibold text-on-brand disabled:opacity-60">
        {pending ? "Removing..." : "Remove listing"}
      </button>
    </form>
  );
}

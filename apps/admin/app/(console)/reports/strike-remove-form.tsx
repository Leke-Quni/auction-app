"use client";

import { Gavel } from "lucide-react";
import { useActionState } from "react";
import type { StrikeRemoveResult } from "./actions";
import { dangerIconButton } from "./buttons";
import { Tip } from "./tip";

export function StrikeRemoveForm({ action, id, username, what }: { action: (state: StrikeRemoveResult, formData: FormData) => Promise<StrikeRemoveResult>; id: string; username: string; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      className="relative"
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Give @${username} a strike and remove this ${what}? The reports about it are closed. This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Tip label={`Give @${username} a strike and remove this ${what}. Reports about it are closed.`}>
        <button disabled={pending} aria-label={`Strike and remove ${what}`} className={dangerIconButton}>
          <Gavel size={13} />
        </button>
      </Tip>
      {state.error && <p role="alert" className="absolute left-0 top-full z-10 mt-1 w-56 whitespace-normal rounded border border-danger bg-panel p-2 text-left text-xs text-danger shadow">{state.error}</p>}
    </form>
  );
}

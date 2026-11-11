"use client";

import { Trash2 } from "lucide-react";
import { dangerIconButton } from "./buttons";
import { Tip } from "./tip";

export function RemovePostForm({ action, id, what }: { action: (formData: FormData) => Promise<void>; id: string; what: "question" | "answer" }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove this ${what}? It disappears from the listing page and every report about it is closed.${what === "question" ? " Its answer goes with it." : ""}`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Tip label={`Remove this ${what} with no strike. Reports about it are closed.`}>
        <button aria-label={`Remove ${what}`} className={dangerIconButton}>
          <Trash2 size={13} />
        </button>
      </Tip>
    </form>
  );
}

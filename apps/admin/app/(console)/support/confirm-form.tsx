"use client";

import { useActionState } from "react";
import type { ActionResult } from "./actions";

// A button that asks first. The server action does the work and may answer with a message, shown under the button.
export function ConfirmForm({ action, fields, label, confirm, tone }: { action: (state: ActionResult, formData: FormData) => Promise<ActionResult>; fields: Record<string, string>; label: string; confirm: string; tone: "primary" | "plain" }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button disabled={pending} className={`cursor-pointer rounded px-2 py-0.5 font-semibold disabled:opacity-60 ${tone === "primary" ? "bg-accent text-on-brand hover:bg-accent-dark" : "border border-line bg-panel hover:bg-page"}`}>{label}</button>
      {state.error && <p role="alert" className="mt-1 text-red-700">{state.error}</p>}
    </form>
  );
}

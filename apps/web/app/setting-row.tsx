"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { FormState } from "./actions";
import { FieldInput, type Field } from "./fields-form";

// Shows a setting's current value with an Edit button. Edit opens a small form in place.
// The form stays mounted while closed (just hidden), so its fields keep their state and Cancel can reset them.
export function SettingRow({
  label,
  value,
  action,
  fields,
  hidden = {},
}: {
  label: string;
  value: string;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: Field[];
  hidden?: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  const cancel = () => {
    formRef.current?.reset();
    setEditing(false);
  };

  return (
    <div className="p-3">
      <div hidden={editing} className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs text-muted">{label}</span>
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label.toLowerCase()}`}
          className="cursor-pointer text-brand underline"
        >
          Edit
        </button>
      </div>
      {!editing && state.ok && <p className="mt-1 text-xs text-brand">{state.ok}</p>}
      <form ref={formRef} action={formAction} hidden={!editing} className="space-y-2">
        <p className="text-sm font-bold">{label}</p>
        {Object.entries(hidden).map(([name, v]) => (
          <input key={name} type="hidden" name={name} value={v} />
        ))}
        {fields.map((f) => (
          <FieldInput key={f.name} field={f} compact />
        ))}
        {editing && state.error && <p className="text-urgent">{state.error}</p>}
        <div className="flex gap-2">
          <button
            disabled={pending}
            className="cursor-pointer bg-brand px-3 py-1 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {pending ? "..." : "Save"}
          </button>
          <button type="button" onClick={cancel} className="cursor-pointer border border-[#888] bg-white px-3 py-1">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

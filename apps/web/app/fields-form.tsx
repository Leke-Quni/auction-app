"use client";

import { useActionState, type InputHTMLAttributes, type ReactNode } from "react";
import type { FormState } from "./actions";

export interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  hint?: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

export function FieldsForm({
  action,
  title,
  fields,
  submit,
  hidden = {},
  narrow,
  compact,
  footer,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  title: string;
  fields: Field[];
  submit: string;
  hidden?: Record<string, string>;
  narrow?: boolean;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={`border border-line bg-white ${compact ? "space-y-2 p-3" : "space-y-3 p-4"} ${narrow ? "mx-auto max-w-sm" : ""}`}
    >
      <h2 className={compact ? "text-sm font-bold" : "text-base font-bold"}>{title}</h2>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((f) => (
        <FieldInput key={f.name} field={f} compact={compact} />
      ))}
      {state.error && <p className="text-urgent">{state.error}</p>}
      {state.ok && <p className="text-brand">{state.ok}</p>}
      <button
        disabled={pending}
        className={`cursor-pointer bg-brand font-bold text-white hover:bg-brand-dark disabled:opacity-60 ${compact ? "px-3 py-1" : "px-4 py-2"}`}
      >
        {pending ? "..." : submit}
      </button>
      {footer}
    </form>
  );
}

export function FieldInput({ field: f, compact }: { field: Field; compact?: boolean }) {
  return (
    <label className="block">
      <span className={compact ? "text-xs text-muted" : "text-muted"}>{f.label}</span>
      {f.hint && <span className="block text-xs text-muted">{f.hint}</span>}
      <input
        name={f.name}
        type={f.type ?? "text"}
        autoComplete={f.autoComplete}
        defaultValue={f.defaultValue}
        required
        {...f.inputProps}
        className={`mt-1 w-full border border-[#888] bg-white ${compact ? "p-1.5 text-sm" : "p-2 text-base"}`}
      />
    </label>
  );
}

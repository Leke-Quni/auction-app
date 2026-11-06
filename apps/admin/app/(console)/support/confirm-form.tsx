"use client";

// A button that asks first. The server action does the work.
export function ConfirmForm({ action, fields, label, confirm, tone }: { action: (formData: FormData) => Promise<void>; fields: Record<string, string>; label: string; confirm: string; tone: "primary" | "plain" }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button className={`cursor-pointer rounded px-2 py-0.5 font-semibold ${tone === "primary" ? "bg-accent text-white hover:bg-accent-dark" : "border border-line bg-panel hover:bg-page"}`}>{label}</button>
    </form>
  );
}

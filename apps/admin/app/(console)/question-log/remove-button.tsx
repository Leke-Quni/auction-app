"use client";

export function RemoveButton({ action, id, target, version }: { action: (formData: FormData) => Promise<void>; id: string; target: "QUESTION" | "ANSWER"; version: string }) {
  const what = target === "QUESTION" ? "question" : "answer";
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove this ${what}? It disappears from the listing page and every open report about it is closed.${target === "QUESTION" ? " Its answer goes with it." : ""}`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="version" value={version} />
      <button className="cursor-pointer rounded bg-danger px-2 py-0.5 text-xs font-semibold text-on-brand">Remove {what}</button>
    </form>
  );
}

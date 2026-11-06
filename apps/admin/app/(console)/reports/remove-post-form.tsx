"use client";

export function RemovePostForm({ action, id, what }: { action: (formData: FormData) => Promise<void>; id: string; what: "question" | "answer" }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove this ${what}? It disappears from the listing page and every report about it is closed.${what === "question" ? " Its answer goes with it." : ""}`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="cursor-pointer rounded bg-danger px-2 py-0.5 font-semibold text-white">Remove {what}</button>
    </form>
  );
}

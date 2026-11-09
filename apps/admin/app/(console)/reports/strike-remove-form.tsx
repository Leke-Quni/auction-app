"use client";

export function StrikeRemoveForm({ action, id, username, what }: { action: (formData: FormData) => Promise<void>; id: string; username: string; what: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Give @${username} a strike and remove this ${what}? The reports about it are closed. This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="cursor-pointer rounded bg-danger px-2 py-0.5 font-semibold text-white">Strike @{username} and remove {what}</button>
    </form>
  );
}

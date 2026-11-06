"use client";

export function StrikeAuthorForm({ action, id, username }: { action: (formData: FormData) => Promise<void>; id: string; username: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Give @${username} a strike for this? The reports about it are closed. The words stay up unless you remove them.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="cursor-pointer rounded bg-warn px-2 py-0.5 font-semibold text-white">Strike @{username}</button>
    </form>
  );
}

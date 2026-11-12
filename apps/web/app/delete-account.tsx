"use client";

import { ACCOUNT_DELETION_GRACE_DAYS, type DeletionBlocker } from "@auction/shared";
import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteAccountAction, sendAccountDeletionCodeAction } from "./actions";

const field = "mt-1 w-full border border-field bg-surface p-1.5 text-sm";

// The last row of the account settings. While something still stops the deletion it lists what, with links; otherwise it explains
// what happens and asks for the password and the emailed code.
export function DeleteAccount({ blockers }: { blockers: DeletionBlocker[] }) {
  const [open, setOpen] = useState(false);
  // Kept in state: a form is cleared after each action, and asking for the code must not wipe the password.
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, sendCode, sending] = useActionState(sendAccountDeletionCodeAction, {});
  const [deleted, confirm, deleting] = useActionState(deleteAccountAction, {});

  if (blockers.length > 0) {
    return (
      <div className="space-y-2 p-3">
        <p className="text-sm font-bold">Delete account</p>
        <p className="text-xs text-muted">You can delete your account once these are finished:</p>
        <ul className="space-y-1.5 text-sm">
          {blockers.map((b) => (
            <li key={`${b.kind}-${b.orderId ?? b.listingId}`}>
              <Link href={b.orderId ? `/orders/${b.orderId}` : `/listings/${b.listingId}`} className="text-brand underline">
                {b.title}
              </Link>
              <span className="block text-xs text-muted">{b.text}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3 p-3">
        <span className="w-24 shrink-0 text-xs text-muted">Delete account</span>
        <span className="min-w-0 flex-1 text-sm text-muted">Close your account and remove your details.</span>
        <button type="button" onClick={() => setOpen(true)} className="cursor-pointer text-brand underline">
          Delete
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-2 p-3">
      <p className="text-sm font-bold">Delete account</p>
      <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
        <li>Your auctions with no bids are ended and your drafts are deleted.</li>
        <li>The account is closed at once: you cannot bid, sell or use the site. For {ACCOUNT_DELETION_GRACE_DAYS} days you can sign in and restore it (ended auctions stay ended).</li>
        <li>After that your name, email, address and watchlist are erased. Bids, orders and ratings stay, shown as &quot;Deleted user&quot;.</li>
      </ul>
      <label className="block">
        <span className="text-xs text-muted">Your password</span>
        <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
      </label>
      <button formAction={sendCode} disabled={sending} className="cursor-pointer border border-field bg-surface px-3 py-1 disabled:opacity-60">
        {sending ? "..." : "Email me a code"}
      </button>
      {sent.ok && <p className="text-xs text-brand">{sent.ok}</p>}
      {sent.error && <p className="text-urgent">{sent.error}</p>}
      <label className="block">
        <span className="text-xs text-muted">6-digit code</span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className={field} />
      </label>
      {deleted.error && <p className="text-urgent">{deleted.error}</p>}
      <div className="flex gap-2">
        <button formAction={confirm} disabled={deleting} className="cursor-pointer rounded-[var(--radius-control)] border border-urgent px-3 py-1 font-bold text-urgent hover:bg-danger-soft disabled:opacity-60">
          {deleting ? "..." : "Delete my account"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="cursor-pointer border border-field bg-surface px-3 py-1">
          Cancel
        </button>
      </div>
    </form>
  );
}

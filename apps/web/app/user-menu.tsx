"use client";

import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useDismiss } from "./use-dismiss";

const itemClass = "block w-full px-3 py-2 text-left hover:bg-head";

export function UserMenu({ username, signOutAction }: { username: string; signOutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full hover:bg-chip"
      >
        <CircleUserRound className="size-6" strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-2 w-52 border border-line bg-surface text-ink shadow-md">
          <p className="border-b border-line px-3 py-2 text-muted">
            Signed in as <b className="text-ink">{username}</b>
          </p>
          <Link role="menuitem" href="/sell/new" onClick={() => setOpen(false)} className={itemClass}>
            Sell an item
          </Link>
          <Link role="menuitem" href="/sell" onClick={() => setOpen(false)} className={itemClass}>
            My listings
          </Link>
          <Link role="menuitem" href="/orders" onClick={() => setOpen(false)} className={itemClass}>
            My orders
          </Link>
          <Link role="menuitem" href="/watchlist" onClick={() => setOpen(false)} className={itemClass}>
            Watchlist
          </Link>
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)} className={itemClass}>
            Account info
          </Link>
          <Link role="menuitem" href="/account/settings" onClick={() => setOpen(false)} className={itemClass}>
            Settings
          </Link>
          <Link role="menuitem" href="/support" onClick={() => setOpen(false)} className={itemClass}>
            Support
          </Link>
          <form action={signOutAction} className="border-t border-line">
            <button role="menuitem" className={`${itemClass} cursor-pointer`}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

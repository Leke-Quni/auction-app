"use client";

import { ChevronUp, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const itemClass = "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-side-on";

// The signed-in admin at the foot of the sidebar. It opens upward, since there is no room below it.
export function AccountMenu({ email, signOutAction }: { email: string; signOutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mx-2 flex w-[calc(100%-1rem)] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-side-line bg-side-on px-2 py-1.5 text-left text-xs hover:border-side-ink"
      >
        <UserRound className="size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-side-active">Account</span>
          <span className="block truncate" title={email}>
            {email}
          </span>
        </span>
        <ChevronUp className={`size-4 shrink-0 transition-transform ${open ? "" : "rotate-180"}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-2 right-2 z-10 mb-1 overflow-hidden rounded-[var(--radius-control)] border border-line bg-panel text-ink shadow-md">
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)} className={itemClass}>
            <UserRound className="size-4 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
            My account
          </Link>
          <Link role="menuitem" href="/account/settings" onClick={() => setOpen(false)} className={itemClass}>
            <Settings className="size-4 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
            Settings
          </Link>
          <form action={signOutAction} className="border-t border-line">
            <button role="menuitem" className={`${itemClass} font-semibold text-danger`}>
              <LogOut className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

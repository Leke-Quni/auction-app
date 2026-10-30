"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const itemClass = "block w-full px-3 py-2 text-left hover:bg-[#f0f0f0]";

export function UserMenu({ username, signOutAction }: { username: string; signOutAction: () => Promise<void> }) {
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
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="10" r="3.2" />
          <path d="M5.8 18.6c1.4-2.4 3.6-3.6 6.2-3.6s4.8 1.2 6.2 3.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-2 w-52 border border-line bg-white text-[#222] shadow-md">
          <p className="border-b border-line px-3 py-2 text-muted">
            Signed in as <b className="text-[#222]">{username}</b>
          </p>
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)} className={itemClass}>
            Account info
          </Link>
          <Link role="menuitem" href="/account/settings" onClick={() => setOpen(false)} className={itemClass}>
            Settings
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

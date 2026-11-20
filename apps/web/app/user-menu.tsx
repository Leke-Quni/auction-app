"use client";

import { CircleUserRound, LifeBuoy, LogOut, Package, Settings, Tag, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useDismiss } from "./use-dismiss";

const itemClass = "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-head";
const iconClass = "size-4 shrink-0 text-muted";

// Two groups, set apart by a line: what the person buys and sells, then the account itself. Selling and the watchlist are in the header.
const GROUPS: { href: string; label: string; Icon: LucideIcon }[][] = [
  [
    { href: "/sell", label: "My listings", Icon: Tag },
    { href: "/orders", label: "My orders", Icon: Package },
  ],
  [
    { href: "/account/settings", label: "Settings", Icon: Settings },
    { href: "/support", label: "Support", Icon: LifeBuoy },
  ],
];

export function UserMenu({ username, signOutAction }: { username: string; signOutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        title="Account menu"
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
          {GROUPS.map((group, index) => (
            <div key={index} className={index > 0 ? "border-t border-line" : ""}>
              {group.map(({ href, label, Icon }) => (
                <Link key={href} role="menuitem" href={href} onClick={() => setOpen(false)} className={itemClass}>
                  <Icon className={iconClass} strokeWidth={1.8} aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          ))}
          <form action={signOutAction} className="border-t border-line">
            <button role="menuitem" className={`${itemClass} cursor-pointer font-bold text-danger`}>
              <LogOut className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

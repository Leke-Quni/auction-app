"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The sections that exist so far. Each step of slice 7 adds its own.
const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/reports", label: "Reports" },
  { href: "/users", label: "Users" },
  { href: "/orders", label: "Orders" },
  { href: "/question-log", label: "Question log" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex flex-col">
      {ITEMS.map((item) => {
        const on = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={on ? "page" : undefined} className={`px-4 py-2 hover:bg-side-on ${on ? "bg-side-on font-semibold text-white" : ""}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

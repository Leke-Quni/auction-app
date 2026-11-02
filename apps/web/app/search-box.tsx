"use client";

import Form from "next/form";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { activeFilterChips, carriedFilters } from "./search/active-filters";
import { readSearchParams } from "./search/search-params";

// The header search. On the search page it shows the current text, keeps the chosen filters when searching again,
// and lists them as chips that each remove one filter.
export function SearchBox({ categories }: { categories: { slug: string; name: string }[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = pathname === "/search" ? readSearchParams(Object.fromEntries(searchParams)) : {};
  const chips = activeFilterChips(params, categories);

  // The header grows when the chips wrap onto a second line; the fixed sidebar on the search page reads its height from here.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = box.current?.closest("header");
    if (!header || typeof ResizeObserver === "undefined") return;
    const publish = () => document.documentElement.style.setProperty("--header-height", `${header.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="flex min-w-0 flex-1 flex-col gap-1 sm:w-full">
      <Form action="/search" className="flex">
        {carriedFilters(params).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input
          key={params.q ?? ""}
          name="q"
          type="search"
          aria-label="Search auctions"
          placeholder="Search auctions"
          maxLength={100}
          defaultValue={params.q}
          className="w-full border border-white bg-white p-1.5 text-sm text-[#222]"
        />
        <button type="submit" className="cursor-pointer border border-white px-3 py-1.5 text-sm font-bold">
          Search
        </button>
      </Form>
      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <li key={chip.id} className="inline-flex items-center gap-1 rounded border border-white/50 bg-black/30 px-1.5 py-0.5 text-xs">
              {chip.label}
              <Link href={chip.href} aria-label={`Remove filter: ${chip.label}`} className="font-bold leading-none">
                ×
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

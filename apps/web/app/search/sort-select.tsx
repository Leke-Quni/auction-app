"use client";

import { SEARCH_SORTS, SEARCH_SORT_LABELS, type SearchSort } from "@auction/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Select } from "../select";

// The two price sorts have a drop-down of their own (under the price filter); the "Sort by" drop-down lists the rest.
const PRICE_SORTS: readonly SearchSort[] = ["priceAsc", "priceDesc"];
const otherOptions = SEARCH_SORTS.filter((sort) => !PRICE_SORTS.includes(sort)).map((sort) => ({ value: sort, label: SEARCH_SORT_LABELS[sort] }));
const priceOptions = PRICE_SORTS.map((sort) => ({ value: sort, label: SEARCH_SORT_LABELS[sort] }));

const SortContext = createContext<{ sort: SearchSort; apply: (sort: SearchSort) => void } | null>(null);
const useSort = () => {
  const context = useContext(SortContext);
  if (!context) throw new Error("A sort drop-down needs a SortProvider around it");
  return context;
};

// Holds the one sort the two drop-downs share, and sends it with the form as a hidden field, whichever of them it came from.
// Picking a sort applies it straight away, together with everything else in the filter form (the conditions ticked, the
// price, "ending soon"), so the results always match what the sidebar shows. Outside a form it sorts the search as it
// stands in the address bar.
export function SortProvider({ defaultValue, children }: { defaultValue: SearchSort; children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const field = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState(defaultValue);

  const apply = (value: SearchSort) => {
    // The hidden field must hold the new sort before the form is sent.
    flushSync(() => setSort(value));
    const form = field.current?.form;
    if (form) return form.requestSubmit();
    const next = new URLSearchParams(searchParams);
    next.set("sort", value);
    next.delete("page");
    router.push(`/search?${next}`);
  };

  return (
    <SortContext.Provider value={{ sort, apply }}>
      <input ref={field} type="hidden" name="sort" value={sort} />
      {children}
    </SortContext.Provider>
  );
}

export function SortSelect({ className }: { className?: string }) {
  const { sort, apply } = useSort();
  return <Select aria-label="Sort by" options={otherOptions} value={sort} placeholder="Sorted by price" className={className} onChange={(value) => apply(value as SearchSort)} />;
}

export function PriceSortSelect({ className }: { className?: string }) {
  const { sort, apply } = useSort();
  return <Select aria-label="Sort by price" options={priceOptions} value={sort} placeholder="Not sorted by price" className={className} onChange={(value) => apply(value as SearchSort)} />;
}

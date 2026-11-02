"use client";

import { SEARCH_SORTS, SEARCH_SORT_LABELS, type SearchSort } from "@auction/shared";
import { useRouter, useSearchParams } from "next/navigation";

// Picking a sort applies it straight away to the search as it stands in the address bar. Filters that were changed
// in the form but not applied are left alone.
export function SortSelect({ defaultValue, className }: { defaultValue: SearchSort; className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      name="sort"
      defaultValue={defaultValue}
      className={className}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        next.set("sort", e.currentTarget.value);
        next.delete("page");
        router.push(`/search?${next}`);
      }}
    >
      {SEARCH_SORTS.map((sort) => (
        <option key={sort} value={sort}>
          {SEARCH_SORT_LABELS[sort]}
        </option>
      ))}
    </select>
  );
}

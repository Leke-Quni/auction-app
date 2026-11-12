"use client";

import { SEARCH_SORTS, SEARCH_SORT_LABELS, type SearchSort } from "@auction/shared";
import { useRouter, useSearchParams } from "next/navigation";

// Picking a sort applies it straight away, together with everything else in the filter form (the conditions ticked, the
// price, "ending soon"), so the results always match what the sidebar shows. Outside a form it sorts the search as it
// stands in the address bar.
export function SortSelect({ defaultValue, className }: { defaultValue: SearchSort; className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      name="sort"
      defaultValue={defaultValue}
      className={className}
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (form) return form.requestSubmit();
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

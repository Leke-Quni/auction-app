"use client";

import { SEARCH_SORTS, SEARCH_SORT_LABELS, type SearchSort } from "@auction/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { Select } from "../select";

const options = SEARCH_SORTS.map((sort) => ({ value: sort, label: SEARCH_SORT_LABELS[sort] }));

// Picking a sort applies it straight away, together with everything else in the filter form (the conditions ticked, the
// price, "ending soon"), so the results always match what the sidebar shows. Outside a form it sorts the search as it
// stands in the address bar.
export function SortSelect({ defaultValue, className }: { defaultValue: SearchSort; className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const box = useRef<HTMLDivElement>(null);

  return (
    <div ref={box}>
      <Select
        name="sort"
        aria-label="Sort by"
        options={options}
        defaultValue={defaultValue}
        className={className}
        onChange={(value) => {
          const form = box.current?.closest("form");
          if (form) return form.requestSubmit();
          const next = new URLSearchParams(searchParams);
          next.set("sort", value);
          next.delete("page");
          router.push(`/search?${next}`);
        }}
      />
    </div>
  );
}

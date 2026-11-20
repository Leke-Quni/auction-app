import { Plus } from "lucide-react";
import Link from "next/link";
import type { FilterChip } from "./active-filters";

// The active filters above the search results, one chip each that removes just that filter. When categories can be added, a second
// row of dashed chips (with a plus) adds each one to the search.
export function FilterChips({ chips, addable = [] }: { chips: FilterChip[]; addable?: FilterChip[] }) {
  if (chips.length === 0 && addable.length === 0) return null;
  return (
    <div className="space-y-4">
      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <li key={chip.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-chip px-2 py-0.5 text-xs text-ink">
              {chip.label}
              <Link href={chip.href} aria-label={`Remove filter: ${chip.label}`} title={`Remove filter: ${chip.label}`} className="font-bold leading-none">
                ×
              </Link>
            </li>
          ))}
        </ul>
      )}
      {addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted">Add a category:</span>
          <ul aria-label="Add a category" className="contents">
            {addable.map((chip) => (
              <li key={chip.id}>
                <Link
                  href={chip.href}
                  aria-label={`Add category: ${chip.label}`}
                  title={`Add category: ${chip.label}`}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand px-2 py-0.5 text-brand hover:bg-brand-soft"
                >
                  <Plus className="size-3" strokeWidth={2.2} aria-hidden="true" />
                  {chip.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

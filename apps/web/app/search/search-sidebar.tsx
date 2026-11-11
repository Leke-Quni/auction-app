import { CONDITION_LABELS, LISTING_CONDITIONS, type SearchSort } from "@auction/shared";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { PriceSlider } from "./price-slider";
import { categoryHref, type SearchPageParams } from "./search-params";
import { SortSelect } from "./sort-select";

const input = "mt-0.5 w-full border border-field bg-surface p-1 text-xs";
const label = "text-[11px] text-muted";

// The page body next to the sidebar. This page is wider than the rest of the site (the layout's column is narrow): on a wide
// screen the sidebar is a column of its own beside the cards, and on a narrow one it stacks on top.
export function SidebarPage({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="relative left-1/2 w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 space-y-3 min-[900px]:grid min-[900px]:grid-cols-[11rem_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6 min-[900px]:space-y-0">
      {sidebar}
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

// Categories and filters, shared by the home page and the search page. Both lead to /search.
// On wide screens the sidebar is its own column, stuck to the top while it fits in the window. Narrower ones stack it on top.
export function SearchSidebar({
  params,
  categories,
  sort,
  maxEuros,
}: {
  params: SearchPageParams;
  categories: { id: string; slug: string; name: string }[];
  sort: SearchSort;
  maxEuros: number;
}) {
  return (
    <aside
      className="space-y-2 text-xs [@media(min-width:900px)_and_(min-height:760px)]:sticky [@media(min-width:900px)_and_(min-height:760px)]:top-[calc(var(--header-height,4.5rem)_+_0.5rem)]"
    >
      <nav aria-label="Categories" className="border border-line bg-surface">
        <h2 className="border-b border-line bg-head px-2 py-1 font-bold">Categories</h2>
        <ul className={`flex flex-wrap gap-x-3 px-2 py-1 min-[900px]:block min-[900px]:px-0`}>
          {[{ id: "all", slug: undefined, name: "All categories" }, ...categories].map((c) => {
            const current = params.category === c.slug;
            return (
              <li key={c.id}>
                <Link
                  href={categoryHref(params, c.slug)}
                  aria-current={current ? "page" : undefined}
                  className={`block py-1 text-brand hover:underline min-[900px]:px-2 min-[900px]:hover:bg-head ${current ? "font-bold" : ""}`}
                >
                  {c.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Form action="/search" className={`grid grid-cols-2 gap-2 border border-line bg-surface p-2 min-[900px]:grid-cols-1`}>
        <h2 className="col-span-2 font-bold min-[900px]:col-span-1">Filters</h2>
        {params.category && <input type="hidden" name="category" value={params.category} />}
        {params.q && <input type="hidden" name="q" value={params.q} />}
        <label className="block">
          <span className={label}>Condition</span>
          <select name="condition" defaultValue={params.condition ?? ""} className={input}>
            <option value="">Any condition</option>
            {LISTING_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Sort by</span>
          <SortSelect defaultValue={sort} className={input} />
        </label>
        <div className="col-span-2 min-[900px]:col-span-1">
          <PriceSlider maxEuros={maxEuros} initialMin={params.minPrice} initialMax={params.maxPrice} />
        </div>
        <label className={`col-span-2 flex items-center gap-1.5 min-[900px]:col-span-1`}>
          <input type="checkbox" name="endingSoon" value="true" defaultChecked={params.endingSoon === "true"} />
          Ending within 24 hours
        </label>
        <div className={`col-span-2 flex items-center gap-2 min-[900px]:col-span-1`}>
          <button type="submit" className="cursor-pointer bg-brand px-3 py-1.5 font-bold text-on-brand hover:bg-brand-dark">
            Apply
          </button>
          <Link href="/search" className="inline-block px-1 py-1.5 text-brand underline">
            Clear
          </Link>
        </div>
      </Form>
    </aside>
  );
}

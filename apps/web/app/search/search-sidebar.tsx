import { CONDITION_LABELS, LISTING_CONDITIONS, type SearchSort } from "@auction/shared";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { PriceSlider } from "./price-slider";
import { categoryHref, type SearchPageParams } from "./search-params";
import { SortSelect } from "./sort-select";

const input = "mt-0.5 w-full border border-[#888] bg-white p-1 text-xs";
const label = "text-[11px] text-muted";

// The page body next to the sidebar. On wide screens both share one grid cell, so the page is as tall as the sidebar
// needs and the sidebar never reaches the footer.
export function SidebarPage({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 min-[1180px]:grid min-[1180px]:space-y-0">
      {sidebar}
      <div className="min-w-0 space-y-3 min-[1180px]:col-start-1 min-[1180px]:row-start-1">{children}</div>
    </div>
  );
}

// Categories and filters, shared by the home page and the search page. Both lead to /search.
// Wide screens have room beside the centred page, so the sidebar sits in the left margin: in the page's flow, so it
// scrolls with the page and never reaches the footer, and stuck to the top while it fits in the window. Narrower
// ones stack it on top.
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
      className="space-y-2 text-xs min-[1180px]:col-start-1 min-[1180px]:row-start-1 min-[1180px]:w-44 min-[1180px]:translate-x-[calc(-100%_-_2rem)] min-[1180px]:self-start [@media(min-width:1180px)_and_(min-height:760px)]:sticky [@media(min-width:1180px)_and_(min-height:760px)]:top-[calc(var(--header-height,4.5rem)_+_0.5rem)]"
    >
      <nav aria-label="Categories" className="border border-line bg-white">
        <h2 className="border-b border-line bg-[#f0f0f0] px-2 py-1 font-bold">Categories</h2>
        <ul className={`flex flex-wrap gap-x-3 px-2 py-1 min-[1180px]:block min-[1180px]:px-0`}>
          {[{ id: "all", slug: undefined, name: "All categories" }, ...categories].map((c) => {
            const current = params.category === c.slug;
            return (
              <li key={c.id}>
                <Link
                  href={categoryHref(params, c.slug)}
                  aria-current={current ? "page" : undefined}
                  className={`block py-0.5 text-brand hover:underline min-[1180px]:px-2 min-[1180px]:hover:bg-[#f0f0f0] ${current ? "font-bold" : ""}`}
                >
                  {c.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Form action="/search" className={`grid grid-cols-2 gap-2 border border-line bg-white p-2 min-[1180px]:grid-cols-1`}>
        <h2 className="col-span-2 font-bold min-[1180px]:col-span-1">Filters</h2>
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
        <div className="col-span-2 min-[1180px]:col-span-1">
          <PriceSlider maxEuros={maxEuros} initialMin={params.minPrice} initialMax={params.maxPrice} />
        </div>
        <label className={`col-span-2 flex items-center gap-1.5 min-[1180px]:col-span-1`}>
          <input type="checkbox" name="endingSoon" value="true" defaultChecked={params.endingSoon === "true"} />
          Ending within 24 hours
        </label>
        <div className={`col-span-2 flex items-center gap-2 min-[1180px]:col-span-1`}>
          <button type="submit" className="cursor-pointer bg-brand px-2.5 py-1 font-bold text-white hover:bg-brand-dark">
            Apply
          </button>
          <Link href="/search" className="px-1 py-1 text-brand underline">
            Clear
          </Link>
        </div>
      </Form>
    </aside>
  );
}

import { CONDITION_LABELS, LISTING_CONDITIONS, SEARCH_SORTS, resolveSearchSort } from "@auction/shared";
import Form from "next/form";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { loadCategories } from "@/lib/categories";
import { ListingCard, type ListingSummary } from "../listing-card";
import { PriceSlider } from "./price-slider";
import { SortSelect } from "./sort-select";
import { sliderMaxEuros } from "./price-scale";
import { SEARCH_PAGE_SIZE, apiQueryFromParams, categoryHref, pageHref, readSearchParams } from "./search-params";

const input = "mt-0.5 w-full border border-[#888] bg-white p-1 text-xs";
const label = "text-[11px] text-muted";

// The dearest live price sets how far the price slider reaches.
async function loadTopPriceCents(): Promise<number | undefined> {
  try {
    const res = await apiFetch("/search?sort=priceDesc&pageSize=1");
    return res.ok ? (await res.json()).items[0]?.startingPriceCents : undefined;
  } catch {
    return undefined;
  }
}

type Outcome = { items: ListingSummary[]; total: number } | { message: string };

async function runSearch(params: ReturnType<typeof readSearchParams>): Promise<Outcome> {
  const built = apiQueryFromParams(params);
  if ("error" in built) return { message: built.error };
  let res: Response;
  try {
    res = await apiFetch(`/search?${built.query}`);
  } catch {
    return { message: "Search is unavailable right now. Try again in a moment." };
  }
  if (res.status === 400) return { message: "Those filters do not work together. Check the price range." };
  if (!res.ok) return { message: "Search is unavailable right now. Try again in a moment." };
  return res.json();
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = readSearchParams(await searchParams);
  const [categories, outcome, topPriceCents] = await Promise.all([loadCategories(), runSearch(params), loadTopPriceCents()]);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const sort = SEARCH_SORTS.includes(params.sort as (typeof SEARCH_SORTS)[number])
    ? (params.sort as (typeof SEARCH_SORTS)[number])
    : resolveSearchSort({ q: params.q ?? "" });

  return (
    <div className="space-y-3 min-[1180px]:grid min-[1180px]:space-y-0">
      {/* Wide screens have room beside the centred page, so the sidebar sits in the left margin: in the page's flow, so it
          scrolls with the page and never reaches the footer, and stuck to the top while it fits in the window. Narrower
          ones stack it on top. */}
      <aside
        className="space-y-2 text-xs min-[1180px]:col-start-1 min-[1180px]:row-start-1 min-[1180px]:w-44 min-[1180px]:translate-x-[calc(-100%_-_0.75rem)] min-[1180px]:self-start [@media(min-width:1180px)_and_(min-height:760px)]:sticky [@media(min-width:1180px)_and_(min-height:760px)]:top-[calc(var(--header-height,4.5rem)_+_0.5rem)]"
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
            <PriceSlider maxEuros={sliderMaxEuros(topPriceCents)} initialMin={params.minPrice} initialMax={params.maxPrice} />
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

      <div className="min-w-0 space-y-3 min-[1180px]:col-start-1 min-[1180px]:row-start-1">
        <h1 className="text-lg font-bold">{params.q ? `Results for "${params.q}"` : "Browse auctions"}</h1>
        {"message" in outcome ? (
          <p className="border border-urgent bg-white p-3 text-urgent">{outcome.message}</p>
        ) : outcome.items.length === 0 ? (
          <div className="border border-line bg-white p-4 text-muted">No auctions match your search.</div>
        ) : (
          <>
            <p className="text-muted">
              {outcome.total} {outcome.total === 1 ? "auction" : "auctions"}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {outcome.items.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            <Pagination params={params} page={page} pages={Math.max(1, Math.ceil(outcome.total / SEARCH_PAGE_SIZE))} />
          </>
        )}
      </div>
    </div>
  );
}

function Pagination({ params, page, pages }: { params: ReturnType<typeof readSearchParams>; page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between">
      {page > 1 ? (
        <Link href={pageHref(params, page - 1)} className="text-brand underline">
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={pageHref(params, page + 1)} className="text-brand underline">
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

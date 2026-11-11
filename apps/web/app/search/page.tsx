import { MAX_SEARCH_RESULTS, SEARCH_SORTS, maxSearchPage, resolveSearchSort } from "@auction/shared";
import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { loadCategories } from "@/lib/categories";
import { viewerIpHeaders } from "@/lib/viewer-ip";
import { ListingCard, type ListingSummary } from "../listing-card";
import { Pagination, pageCount } from "../pagination";
import { sliderMaxEuros } from "./price-scale";
import { SearchSidebar, SidebarPage } from "./search-sidebar";
import { SEARCH_PAGE_SIZE, apiQueryFromParams, pageHref, readSearchParams } from "./search-params";
import { loadTopPriceCents } from "./top-price";

type Outcome = { items: ListingSummary[]; total: number } | { message: string };

async function runSearch(params: ReturnType<typeof readSearchParams>): Promise<Outcome> {
  const built = apiQueryFromParams(params);
  if ("error" in built) return { message: built.error };
  let res: Response;
  try {
    res = await apiFetch(`/search?${built.query}`, { headers: await viewerIpHeaders() });
  } catch {
    return { message: "Search is unavailable right now. Try again in a moment." };
  }
  if (res.status === 429) return { message: "You are searching too fast. Wait a moment and try again." };
  if (res.status === 400) return { message: "Those filters do not work together. Check the price range." };
  if (!res.ok) return { message: "Search is unavailable right now. Try again in a moment." };
  return res.json();
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = readSearchParams(await searchParams);
  const [categories, outcome, topPriceCents] = await Promise.all([loadCategories(), runSearch(params), loadTopPriceCents()]);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // A page past the last one (an old link, or a search that now has fewer results) goes to the last page instead.
  const pages = "message" in outcome ? 1 : Math.min(pageCount(outcome.total, SEARCH_PAGE_SIZE), maxSearchPage(SEARCH_PAGE_SIZE));
  if (!("message" in outcome) && page > pages) {
    redirect(pageHref(params, pages));
  }
  const sort = SEARCH_SORTS.includes(params.sort as (typeof SEARCH_SORTS)[number])
    ? (params.sort as (typeof SEARCH_SORTS)[number])
    : resolveSearchSort({ q: params.q ?? "" });

  return (
    <SidebarPage sidebar={<SearchSidebar params={params} categories={categories} sort={sort} maxEuros={sliderMaxEuros(topPriceCents)} />}>
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
          {outcome.total > MAX_SEARCH_RESULTS && (
            <p className="text-muted">Only the first {MAX_SEARCH_RESULTS.toLocaleString("en")} results can be shown. Use a filter to narrow the search.</p>
          )}
          <Pagination page={page} pages={pages} hrefFor={(n) => pageHref(params, n)} />
        </>
      )}
    </SidebarPage>
  );
}

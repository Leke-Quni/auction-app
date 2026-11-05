import Link from "next/link";
import { resolveSearchSort } from "@auction/shared";
import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { loadCategories } from "@/lib/categories";
import { ListingCard, type ListingSummary } from "./listing-card";
import { Pagination, pageCount } from "./pagination";
import { sliderMaxEuros } from "./search/price-scale";
import { SearchSidebar, SidebarPage } from "./search/search-sidebar";
import { loadTopPriceCents } from "./search/top-price";

const PAGE_SIZE = 24;
const SECTION_SIZE = 4;

async function loadSection(section: "endingSoon" | "upcoming") {
  const res = await apiFetch(`/listings?section=${section}&pageSize=${SECTION_SIZE}`);
  if (!res.ok) throw new Error(`API /listings?section=${section} failed: ${res.status}`);
  const { items }: { items: ListingSummary[] } = await res.json();
  return items;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  // Everything the page needs is asked for at once: the sections do not depend on the list, only on this being page 1.
  const [res, categories, topPriceCents, endingSoon, upcoming] = await Promise.all([
    apiFetch(`/listings?page=${page}&pageSize=${PAGE_SIZE}`),
    loadCategories(),
    loadTopPriceCents(),
    page === 1 ? loadSection("endingSoon") : [],
    page === 1 ? loadSection("upcoming") : [],
  ]);
  if (!res.ok) throw new Error(`API /listings failed: ${res.status}`);
  const { items, total }: { items: ListingSummary[]; total: number } = await res.json();
  const pages = pageCount(total, PAGE_SIZE);
  if (page > pages) redirect(pages === 1 ? "/" : `/?page=${pages}`);
  const sections = [
    { title: "Ending soon", items: endingSoon },
    { title: "Upcoming", items: upcoming },
  ].filter((section) => section.items.length > 0);

  return (
    <SidebarPage sidebar={<SearchSidebar params={{}} categories={categories} sort={resolveSearchSort({ q: "" })} maxEuros={sliderMaxEuros(topPriceCents)} />}>
      {sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="text-lg font-bold">{section.title}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {section.items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      ))}
      <h1 className="text-lg font-bold">Auctions</h1>
      {items.length === 0 ? (
        <div className="border border-line bg-white p-4 text-muted">
          No auctions yet.{" "}
          <Link href="/sell/new" className="text-brand underline">
            Sell something
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {items.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
      <Pagination page={page} pages={pages} hrefFor={(n) => (n === 1 ? "/" : `/?page=${n}`)} />
    </SidebarPage>
  );
}

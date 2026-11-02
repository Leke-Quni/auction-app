import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { ListingCard, type ListingSummary } from "./listing-card";

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
  const res = await apiFetch(`/listings?page=${page}&pageSize=${PAGE_SIZE}`);
  if (!res.ok) throw new Error(`API /listings failed: ${res.status}`);
  const { items, total }: { items: ListingSummary[]; total: number } = await res.json();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [endingSoon, upcoming] = page === 1 ? await Promise.all([loadSection("endingSoon"), loadSection("upcoming")]) : [[], []];
  const sections = [
    { title: "Ending soon", items: endingSoon },
    { title: "Upcoming", items: upcoming },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="space-y-3">
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
      {pages > 1 && (
        <nav className="flex items-center justify-between">
          {page > 1 ? (
            <Link href={`/?page=${page - 1}`} className="text-brand underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={`/?page=${page + 1}`} className="text-brand underline">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

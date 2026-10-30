import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { ListingCard, type ListingSummary } from "./listing-card";

const PAGE_SIZE = 24;

export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const res = await apiFetch(`/listings?page=${page}&pageSize=${PAGE_SIZE}`);
  if (!res.ok) throw new Error(`API /listings failed: ${res.status}`);
  const { items, total }: { items: ListingSummary[]; total: number } = await res.json();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Auctions</h1>
      {items.length === 0 ? (
        <div className="border border-line bg-white p-4 text-muted">
          No auctions yet.{" "}
          <Link href="/sell/new" className="text-brand underline">
            Sell something
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { ListingCard, type ListingSummary } from "../listing-card";
import { removeFromWatchlistAction } from "../watchlist-actions";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "upcoming", label: "Upcoming" },
  { key: "ended", label: "Ended" },
] as const;

export default async function WatchlistPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  if (!(await auth())) redirect("/sign-in");
  const { show } = await searchParams;
  const filter = FILTERS.find((f) => f.key === show)?.key ?? "all";
  const res = await authedApiFetch("/watchlist");
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /watchlist failed: ${res.status}`);
  const { items }: { items: ListingSummary[] } = await res.json();
  const counts = { all: items.length, live: 0, upcoming: 0, ended: 0 };
  for (const item of items) if (item.phase in counts) counts[item.phase as "live" | "upcoming" | "ended"]++;
  const shown = filter === "all" ? items : items.filter((i) => i.phase === filter);

  return (
    <div className="space-y-3">
      <h1 className="border border-line bg-white p-2 text-lg font-bold">Your watchlist</h1>
      <nav aria-label="Filter watchlist" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/watchlist" : `/watchlist?show=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={`border px-3 py-1 ${filter === f.key ? "border-brand bg-brand text-white" : "border-line bg-white text-brand hover:border-brand"}`}
          >
            {f.label} ({counts[f.key]})
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <div className="border border-line bg-white p-4 text-muted">
          You are not watching any auctions yet. Press <b>Watch</b> on an auction to keep it here; we email you about 24 hours before it ends.
        </div>
      ) : shown.length === 0 ? (
        <div className="border border-line bg-white p-4 text-muted">None of your watched auctions are {filter}.</div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {shown.map((listing) => (
            <li key={listing.id} className="flex flex-col gap-1">
              {/* The card stretches to the tallest one in its row, so every "Stop watching" link lines up underneath. */}
              <div className="flex-1 [&>a]:h-full">
                <ListingCard listing={listing} />
              </div>
              <form action={removeFromWatchlistAction}>
                <input type="hidden" name="listingId" value={listing.id} />
                <button className="cursor-pointer text-xs text-muted underline hover:text-urgent">Stop watching</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

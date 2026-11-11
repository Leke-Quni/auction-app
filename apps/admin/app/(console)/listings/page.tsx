import { formatEur } from "@auction/shared";
import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

interface Row {
  id: string;
  title: string;
  phase: "upcoming" | "live" | "ended";
  seller: { id: string; username: string };
  bidCount: number;
  priceCents: number;
  endsAt: string | null;
  outcome: "SOLD" | "NO_SALE" | "NO_BIDS" | null;
  removed: boolean;
}

const PHASES = ["live", "upcoming", "ended", "removed"] as const;
const PILL = { live: "bg-ok-soft text-ok", upcoming: "bg-warn-soft text-warn", ended: "bg-page text-muted" } as const;
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function Listings({ searchParams }: { searchParams: Promise<{ q?: string; phase?: string }> }) {
  await requireAdmin();
  const { q = "", phase = "" } = await searchParams;
  const query = new URLSearchParams();
  if (q.trim()) query.set("q", q.trim());
  if ((PHASES as readonly string[]).includes(phase)) query.set("phase", phase);
  const res = await adminApiFetch(`/admin/listings?${query}`);
  if (!res.ok) throw new Error(`API /admin/listings failed: ${res.status}`);
  const { listings } = (await res.json()) as { listings: Row[] };
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Listings</h1>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Listing id, title or seller" className="w-80 rounded border border-line bg-panel px-2 py-1" />
        <select name="phase" defaultValue={phase} className="rounded border border-line bg-panel px-2 py-1">
          <option value="">Any state</option>
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {p[0]!.toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark">Search</button>
      </form>
      {listings.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">No listings match. Drafts are not shown.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left">
          <thead className="bg-page text-muted">
            <tr>
              <th className="p-2">Item</th>
              <th className="p-2">Seller</th>
              <th className="p-2">State</th>
              <th className="p-2">Price</th>
              <th className="p-2">Bids</th>
              <th className="p-2">Ends</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id} className="border-t border-line align-top">
                <td className="p-2">
                  <Link href={`/listings/${l.id}`} className="text-accent underline">
                    {l.title}
                  </Link>
                </td>
                <td className="p-2">
                  <Link href={`/users/${l.seller.id}`} className="text-accent underline">
                    @{l.seller.username}
                  </Link>
                </td>
                <td className="p-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${PILL[l.phase]}`}>{l.phase}</span>
                  {l.removed && <span className="ml-1 rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">removed</span>}
                  {l.phase === "ended" && !l.removed && l.outcome && <span className="ml-1 text-xs text-muted">{l.outcome.replace("_", " ").toLowerCase()}</span>}
                </td>
                <td className="whitespace-nowrap p-2">{formatEur(l.priceCents)}</td>
                <td className="p-2">{l.bidCount}</td>
                <td className="whitespace-nowrap p-2 text-muted">{l.endsAt ? when(l.endsAt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

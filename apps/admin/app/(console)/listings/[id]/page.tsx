import Link from "next/link";
import { notFound } from "next/navigation";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { RemoveForm } from "./remove-form";

interface Person {
  id: string;
  username: string | null;
}
interface Listing {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED";
  phase: "draft" | "upcoming" | "live" | "ended";
  seller: Person;
  highBidder: Person | null;
  bidCount: number;
  currentBidCents: number | null;
  startingPriceCents: number;
  reservePriceCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  closedAt: string | null;
  outcome: "SOLD" | "NO_SALE" | "NO_BIDS" | null;
  removal: { at: string; reason: string; by: Person | null } | null;
}

const eur = (cents: number | null) => (cents === null ? "-" : new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100));
const when = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-");
const name = (p: Person | null) =>
  p ? (
    p.username ? (
      <Link href={`/users/${p.id}`} className="text-accent underline">
        @{p.username}
      </Link>
    ) : (
      "deleted user"
    )
  ) : (
    "-"
  );

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const res = await adminApiFetch(`/admin/listings/${encodeURIComponent(id)}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /admin/listings failed: ${res.status}`);
  const l = (await res.json()) as Listing;
  const rows: [string, React.ReactNode][] = [
    ["State", l.phase],
    ["Seller", name(l.seller)],
    ["Starting price", eur(l.startingPriceCents)],
    ["Reserve", eur(l.reservePriceCents)],
    ["Current bid", `${eur(l.currentBidCents)} (${l.bidCount} bid${l.bidCount === 1 ? "" : "s"})`],
    ["High bidder", name(l.highBidder)],
    ["Starts", when(l.startsAt)],
    ["Ends", when(l.endsAt)],
    ["Result", l.outcome ?? "-"],
    ["Orders", <Link key="o" href={`/orders?q=${l.id}`} className="text-accent underline">Orders for this listing</Link>],
  ];
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-lg font-bold">{l.title}</h1>
      <table className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-line first:border-t-0">
              <th className="w-40 bg-page p-2 font-normal text-muted">{k}</th>
              <td className="p-2">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-2 rounded border border-line bg-panel p-4">
        {l.removal ? (
          <>
            <p className="font-semibold text-danger">Removed {when(l.removal.at)} by {name(l.removal.by)}</p>
            <p className="whitespace-pre-wrap break-words">{l.removal.reason}</p>
          </>
        ) : l.status === "PUBLISHED" && !l.closedAt && l.phase !== "ended" ? (
          <>
            <h2 className="font-bold">Remove this listing</h2>
            <p className="text-muted">The auction ends now with no sale, whatever the bids and the reserve. Every bidder is emailed that nobody won. The seller cannot list it again.</p>
            <RemoveForm id={l.id} bidCount={l.bidCount} />
          </>
        ) : (
          <p className="text-muted">{l.status === "DRAFT" ? "A draft is private and cannot be removed." : "This auction has already ended, so it cannot be removed."}</p>
        )}
      </div>
    </div>
  );
}

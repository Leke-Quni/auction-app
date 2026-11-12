import Link from "next/link";
import { notFound } from "next/navigation";
import { formatEur, MAX_STRIKES } from "@auction/shared";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { BanForm, ClearStrikeForm, RoleForm, StrikeForm, UnbanForm } from "./forms";

interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  isSuperAdmin: boolean;
  createdAt: string;
  emailVerified: boolean;
  bannedAt: string | null;
  banReason: string | null;
  strikeCount: number;
  listingCount: number;
  bidCount: number;
  strikes: { id: string; createdAt: string; orderId: string | null; reason: string | null; givenByAdmin: boolean; listing: { id: string; title: string } | null }[];
}

interface ListingRow {
  id: string;
  title: string;
  phase: "upcoming" | "live" | "ended";
  bidCount: number;
  priceCents: number;
  endsAt: string | null;
  outcome: "SOLD" | "NO_SALE" | "NO_BIDS" | null;
  removed: boolean;
}

interface BidRow {
  id: string;
  title: string;
  state: "leading" | "outbid" | "won" | "lost" | "removed";
  yourHighestCents: number;
  yourBids: number;
  priceCents: number | null;
  endsAt: string | null;
}

const SHOWN = 20;
const PHASE_PILL = { live: "bg-ok-soft text-ok", upcoming: "bg-warn-soft text-warn", ended: "bg-page text-muted" } as const;
const STATE_PILL = { leading: "bg-ok-soft text-ok", won: "bg-ok-soft text-ok", outbid: "bg-warn-soft text-warn", lost: "bg-page text-muted", removed: "bg-danger-soft text-danger" } as const;

const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  const { id } = await params;
  const key = encodeURIComponent(id);
  const [res, listingsRes, bidsRes] = await Promise.all([
    adminApiFetch(`/admin/users/${key}`),
    adminApiFetch(`/admin/listings?sellerId=${key}&limit=${SHOWN}`),
    adminApiFetch(`/admin/users/${key}/bids?limit=${SHOWN}`),
  ]);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /admin/users failed: ${res.status}`);
  if (!listingsRes.ok) throw new Error(`API /admin/listings failed: ${listingsRes.status}`);
  if (!bidsRes.ok) throw new Error(`API /admin/users/bids failed: ${bidsRes.status}`);
  const u = (await res.json()) as User;
  const { listings, total: listingTotal } = (await listingsRes.json()) as { listings: ListingRow[]; total: number };
  const { auctions, total: auctionTotal } = (await bidsRes.json()) as { auctions: BidRow[]; total: number };
  const rows: [string, React.ReactNode][] = [
    ["Name", u.name],
    ["Email", `${u.email}${u.emailVerified ? "" : " (not verified)"}`],
    ["Role", u.isSuperAdmin ? "SUPER ADMIN" : u.role],
    ["Joined", when(u.createdAt)],
    ["Listings", `${u.listingCount} (drafts included)`],
    ["Bids", String(u.bidCount)],
    ["Strikes", `${u.strikeCount} (bidding is blocked at ${MAX_STRIKES})`],
    ["Orders", <Link key="o" href={`/orders?q=${encodeURIComponent(u.username)}`} className="text-accent underline">Orders as buyer or seller</Link>],
  ];
  return (
    <div className="max-w-4xl space-y-3">
      <h1 className="text-lg font-bold">
        @{u.username} {u.bannedAt && <span className="ml-1 rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">banned</span>}
      </h1>
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
        <h2 className="font-bold">Listings</h2>
        {listings.length === 0 ? (
          <p className="text-muted">No published listings. Drafts are private and not shown.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Item</th>
                    <th className="py-1 pr-3 font-normal">State</th>
                    <th className="py-1 pr-3 font-normal">Price</th>
                    <th className="py-1 pr-3 font-normal">Bids</th>
                    <th className="py-1 font-normal">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3">
                        <Link href={`/listings/${l.id}`} className="text-accent underline">
                          {l.title}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${PHASE_PILL[l.phase]}`}>{l.phase}</span>
                        {l.removed && <span className="ml-1 rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">removed</span>}
                        {l.phase === "ended" && !l.removed && l.outcome && <span className="ml-1 text-xs text-muted">{l.outcome.replace("_", " ").toLowerCase()}</span>}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3">{formatEur(l.priceCents)}</td>
                      <td className="py-1.5 pr-3">{l.bidCount}</td>
                      <td className="whitespace-nowrap py-1.5 text-muted">{l.endsAt ? when(l.endsAt) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted">
              {listingTotal > listings.length ? `Latest ${listings.length} of ${listingTotal}. ` : ""}
              <Link href={`/listings?sellerId=${key}`} className="text-accent underline">
                Open in the Listings page
              </Link>
            </p>
          </>
        )}
      </div>

      <div className="space-y-2 rounded border border-line bg-panel p-4">
        <h2 className="font-bold">Auctions they bid on</h2>
        {auctions.length === 0 ? (
          <p className="text-muted">No bids.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Item</th>
                    <th className="py-1 pr-3 font-normal">Standing</th>
                    <th className="py-1 pr-3 font-normal">Their highest bid</th>
                    <th className="py-1 pr-3 font-normal">Price</th>
                    <th className="py-1 pr-3 font-normal">Their bids</th>
                    <th className="py-1 font-normal">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {auctions.map((a) => (
                    <tr key={a.id} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3">
                        <Link href={`/listings/${a.id}`} className="text-accent underline">
                          {a.title}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATE_PILL[a.state]}`}>{a.state}</span>
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3">{formatEur(a.yourHighestCents)}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3">{a.priceCents === null ? "" : formatEur(a.priceCents)}</td>
                      <td className="py-1.5 pr-3">{a.yourBids}</td>
                      <td className="whitespace-nowrap py-1.5 text-muted">{a.endsAt ? when(a.endsAt) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {auctionTotal > auctions.length && <p className="text-muted">Latest {auctions.length} of {auctionTotal} auctions.</p>}
          </>
        )}
      </div>

      <div className="space-y-2 rounded border border-line bg-panel p-4">
        <h2 className="font-bold">Strikes</h2>
        {u.strikes.length === 0 ? (
          <p className="text-muted">No strikes.</p>
        ) : (
          <ul className="divide-y divide-line">
            {u.strikes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  {when(s.createdAt)},{" "}
                  {s.givenByAdmin ? <b>given by an admin</b> : <>did not pay for</>}
                  {s.givenByAdmin ? (s.listing ? <>, about </> : null) : " "}
                  {s.listing ? (
                    <Link href={`/listings/${s.listing.id}`} className="text-accent underline">
                      {s.listing.title}
                    </Link>
                  ) : s.givenByAdmin ? null : (
                    <span className="text-muted">a removed listing</span>
                  )}
                  {s.givenByAdmin && s.reason && <span className="mt-0.5 block whitespace-pre-wrap break-words text-muted">{s.reason}</span>}
                </span>
                <ClearStrikeForm id={u.id} strikeId={s.id} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 rounded border border-line bg-panel p-4">
        <h2 className="font-bold">Give a strike</h2>
        {u.role === "ADMIN" ? (
          <p className="text-muted">An admin cannot be given a strike. Remove their admin role first.</p>
        ) : (
          <>
            <p className="text-muted">A strike for conduct. Two strikes stop a person bidding, as for an unpaid auction. They are not emailed.</p>
            <StrikeForm id={u.id} username={u.username} strikes={u.strikeCount} max={MAX_STRIKES} />
          </>
        )}
      </div>

      <div className="space-y-2 rounded border border-line bg-panel p-4">
        {u.bannedAt ? (
          <>
            <p className="font-semibold text-danger">Banned {when(u.bannedAt)}</p>
            <p className="whitespace-pre-wrap break-words">{u.banReason}</p>
            <p className="text-muted">Restoring the account lets them sign in and use the site again.</p>
            <UnbanForm id={u.id} username={u.username} />
          </>
        ) : u.role === "ADMIN" ? (
          <p className="text-muted">An admin cannot be banned. Remove their admin role first (in the Admin role box below).</p>
        ) : (
          <>
            <h2 className="font-bold">Ban this account</h2>
            <p className="text-muted">They are signed out everywhere at once and can no longer bid, sell or sign in. Their listings, bids and orders stay as they are, and a payout is not held back.</p>
            <BanForm id={u.id} username={u.username} />
          </>
        )}
      </div>

      <div className="space-y-2 rounded border border-line bg-panel p-4">
        <h2 className="font-bold">Admin role</h2>
        {!me.isSuperAdmin ? (
          <p className="text-muted">Only a super admin can change admin roles.</p>
        ) : u.isSuperAdmin ? (
          <p className="text-muted">A super admin&apos;s role can only be changed from the command line.</p>
        ) : u.id === me.id ? (
          <p className="text-muted">This is you. Another admin has to change your role.</p>
        ) : (
          <>
            <p className="text-muted">
              {u.role === "ADMIN" ? "An admin can use this app. Removing the role takes effect on their next request." : u.bannedAt ? "A banned account cannot be made an admin. Restore it first." : "Gives this account access to this app."}
            </p>
            {(u.role === "ADMIN" || !u.bannedAt) && <RoleForm id={u.id} username={u.username} role={u.role} />}
          </>
        )}
      </div>
    </div>
  );
}

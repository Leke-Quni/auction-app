import Link from "next/link";
import { notFound } from "next/navigation";
import { MAX_STRIKES } from "@auction/shared";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { BanForm, ClearStrikeForm, UnbanForm } from "./forms";

interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  emailVerified: boolean;
  bannedAt: string | null;
  banReason: string | null;
  strikeCount: number;
  listingCount: number;
  bidCount: number;
  strikes: { id: string; createdAt: string; orderId: string; listing: { id: string; title: string } | null }[];
}

const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const res = await adminApiFetch(`/admin/users/${encodeURIComponent(id)}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /admin/users failed: ${res.status}`);
  const u = (await res.json()) as User;
  const rows: [string, string][] = [
    ["Name", u.name],
    ["Email", `${u.email}${u.emailVerified ? "" : " (not verified)"}`],
    ["Role", u.role],
    ["Joined", when(u.createdAt)],
    ["Listings", String(u.listingCount)],
    ["Bids", String(u.bidCount)],
    ["Strikes", `${u.strikeCount} (bidding is blocked at ${MAX_STRIKES})`],
  ];
  return (
    <div className="max-w-2xl space-y-3">
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
        <h2 className="font-bold">Strikes</h2>
        {u.strikes.length === 0 ? (
          <p className="text-muted">No strikes.</p>
        ) : (
          <ul className="divide-y divide-line">
            {u.strikes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  {when(s.createdAt)}, did not pay for{" "}
                  {s.listing ? (
                    <Link href={`/listings/${s.listing.id}`} className="text-accent underline">
                      {s.listing.title}
                    </Link>
                  ) : (
                    <span className="text-muted">a removed listing</span>
                  )}
                </span>
                <ClearStrikeForm id={u.id} strikeId={s.id} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 rounded border border-line bg-panel p-4">
        {u.bannedAt ? (
          <>
            <p className="font-semibold text-danger">Banned {when(u.bannedAt)}</p>
            <p className="whitespace-pre-wrap break-words">{u.banReason}</p>
            <p className="text-muted">Restoring the account lets them sign in and use the site again.</p>
            <UnbanForm id={u.id} />
          </>
        ) : u.role === "ADMIN" ? (
          <p className="text-muted">An admin cannot be banned. Remove their admin role first (`make-admin --remove`).</p>
        ) : (
          <>
            <h2 className="font-bold">Ban this account</h2>
            <p className="text-muted">They are signed out everywhere at once and can no longer bid, sell or sign in. Their listings, bids and orders stay as they are, and a payout is not held back.</p>
            <BanForm id={u.id} username={u.username} />
          </>
        )}
      </div>
    </div>
  );
}

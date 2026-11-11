import Link from "next/link";
import { notFound } from "next/navigation";
import { MAX_STRIKES } from "@auction/shared";
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

const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  const { id } = await params;
  const res = await adminApiFetch(`/admin/users/${encodeURIComponent(id)}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /admin/users failed: ${res.status}`);
  const u = (await res.json()) as User;
  const rows: [string, React.ReactNode][] = [
    ["Name", u.name],
    ["Email", `${u.email}${u.emailVerified ? "" : " (not verified)"}`],
    ["Role", u.isSuperAdmin ? "SUPER ADMIN" : u.role],
    ["Joined", when(u.createdAt)],
    ["Listings", String(u.listingCount)],
    ["Bids", String(u.bidCount)],
    ["Strikes", `${u.strikeCount} (bidding is blocked at ${MAX_STRIKES})`],
    ["Orders", <Link key="o" href={`/orders?q=${encodeURIComponent(u.username)}`} className="text-accent underline">Orders as buyer or seller</Link>],
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

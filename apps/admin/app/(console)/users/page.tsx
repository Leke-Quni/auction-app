import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

interface UserRow {
  id: string;
  username: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  emailVerified: boolean;
  bannedAt: string | null;
  strikeCount: number;
  listingCount: number;
  bidCount: number;
}

const day = (iso: string) => iso.slice(0, 10);

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; banned?: string }> }) {
  await requireAdmin();
  const { q = "", banned } = await searchParams;
  const query = new URLSearchParams();
  if (q.trim()) query.set("q", q.trim());
  if (banned === "true") query.set("banned", "true");
  const res = await adminApiFetch(`/admin/users?${query}`);
  if (!res.ok) throw new Error(`API /admin/users failed: ${res.status}`);
  const { users } = (await res.json()) as { users: UserRow[] };
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Users</h1>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Username, email or id" className="w-full max-w-[18rem] rounded border border-line bg-panel px-2 py-1" />
        <label className="flex items-center gap-1">
          <input type="checkbox" name="banned" value="true" defaultChecked={banned === "true"} /> Banned only
        </label>
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark">Search</button>
      </form>
      {users.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">No accounts match.</p>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left">
          <thead className="bg-page text-muted">
            <tr>
              <th className="p-2">Username</th>
              <th className="p-2">Email</th>
              <th className="p-2">Joined</th>
              <th className="p-2">Listings</th>
              <th className="p-2">Bids</th>
              <th className="p-2">Strikes</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="p-2">
                  <Link href={`/users/${u.id}`} className="text-accent underline">
                    @{u.username}
                  </Link>
                  {u.role === "ADMIN" && <span className="ml-1 rounded bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info">admin</span>}
                </td>
                <td className="p-2">{u.email}</td>
                <td className="p-2 text-muted">{day(u.createdAt)}</td>
                <td className="p-2">{u.listingCount}</td>
                <td className="p-2">{u.bidCount}</td>
                <td className="p-2">{u.strikeCount}</td>
                <td className="p-2">{u.bannedAt ? <span className="rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">banned</span> : <span className="text-muted">active</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

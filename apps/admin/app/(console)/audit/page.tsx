import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

interface Entry {
  id: string;
  action: "BAN_USER" | "UNBAN_USER" | "CLEAR_STRIKE" | "REMOVE_LISTING" | "VIEW_ORDER" | "REMOVE_POST" | "SET_ROLE" | "STRIKE_USER";
  targetId: string;
  reason: string | null;
  createdAt: string;
  admin: { id: string; username: string | null };
}

const FILTERS = ["adminId", "targetId"] as const;
const LABEL = { BAN_USER: "Banned a user", UNBAN_USER: "Restored a user", CLEAR_STRIKE: "Cleared a strike", REMOVE_LISTING: "Removed a listing", VIEW_ORDER: "Opened an order", REMOVE_POST: "Removed a question or answer", SET_ROLE: "Changed an admin role", STRIKE_USER: "Gave a strike" } as const;
const HREF = { BAN_USER: "/users", UNBAN_USER: "/users", CLEAR_STRIKE: "/users", REMOVE_LISTING: "/listings", VIEW_ORDER: "/orders", REMOVE_POST: "/question-log?questionId=", SET_ROLE: "/users", STRIKE_USER: "/users" } as const;
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";

export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of FILTERS) if (params[key]) query.set(key, params[key]!);
  const res = await adminApiFetch(`/admin/audit?${query}`);
  if (!res.ok) throw new Error(`API /admin/audit failed: ${res.status}`);
  const { entries } = (await res.json()) as { entries: Entry[] };
  const filtered = FILTERS.filter((k) => params[k]);
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Audit log</h1>
      <p className="text-muted">Which admin banned, restored, cleared a strike, removed a listing or opened an order (both addresses), newest first. Entries are kept for ever.</p>
      {filtered.length > 0 && (
        <p>
          Showing only {filtered.map((k) => `${k} ${params[k]}`).join(", ")}.{" "}
          <Link href="/audit" className="text-accent underline">
            Show all
          </Link>
        </p>
      )}
      {entries.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">No entries.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left">
          <thead className="bg-page text-muted">
            <tr>
              <th className="p-2">When</th>
              <th className="p-2">Admin</th>
              <th className="p-2">What</th>
              <th className="p-2">Target</th>
              <th className="p-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-2 text-muted">{when(e.createdAt)}</td>
                <td className="p-2">
                  <Link href={`/audit?adminId=${encodeURIComponent(e.admin.id)}`} className="text-accent underline">
                    {e.admin.username ? `@${e.admin.username}` : "deleted user"}
                  </Link>
                </td>
                <td className="p-2">{LABEL[e.action]}</td>
                <td className="p-2">
                  <Link href={e.action === "REMOVE_POST" ? `${HREF[e.action]}${encodeURIComponent(e.targetId)}` : `${HREF[e.action]}/${encodeURIComponent(e.targetId)}`} className="text-accent underline">
                    {e.targetId}
                  </Link>
                </td>
                <td className="max-w-md whitespace-pre-wrap break-words p-2">{e.action === "CLEAR_STRIKE" ? <span className="text-muted">strike {e.reason}</span> : e.action === "SET_ROLE" ? <span className="text-muted">now {e.reason === "ADMIN" ? "an admin" : "an ordinary user"}</span> : (e.reason ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

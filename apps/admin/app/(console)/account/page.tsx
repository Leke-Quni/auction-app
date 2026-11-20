import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

export const metadata = { title: "My account - Auctionly Admin" };

// The signed-in admin's own details, read-only. `requireAdmin` first, so a demoted admin never sees it.
export default async function Account() {
  const admin = await requireAdmin();
  const res = await adminApiFetch("/me").catch(() => null);
  if (!res?.ok) throw new Error(`API /me failed: ${res?.status ?? "not reachable"}`);
  const me = await res.json();
  const rows: [string, string][] = [
    ["Username", me.username],
    ["First name", me.firstName],
    ["Last name", me.lastName],
    ["Email", me.email],
    ["Email verified", me.emailVerified ? new Date(me.emailVerified).toUTCString() : "No"],
    ["Role", admin.isSuperAdmin ? "Super admin" : "Admin"],
  ];
  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-lg font-bold">My account</h1>
      <section className="overflow-hidden rounded border border-line bg-panel">
        <table className="w-full border-collapse text-left">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-t border-line first:border-t-0">
                <th className="w-44 bg-page p-2 align-top font-normal text-muted">{label}</th>
                <td className="p-2 break-words">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p>
        <Link href="/account/settings" className="text-accent underline">
          Change your name or password
        </Link>
      </p>
    </div>
  );
}

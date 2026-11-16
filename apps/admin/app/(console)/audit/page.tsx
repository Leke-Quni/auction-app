import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { AuditTable } from "./audit-table";

const FILTERS = ["adminId", "targetId", "q"] as const;

export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const filters: Record<string, string> = {};
  for (const key of FILTERS) if (params[key]) filters[key] = params[key]!;
  const filtered = FILTERS.filter((k) => params[k]);
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Audit log</h1>
      <p className="text-muted">Which admin banned, restored, cleared a strike, removed a listing or opened an order (both addresses), newest first. Entries are kept for ever.</p>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={params.q ?? ""} placeholder="Admin username, email or id" className="w-full max-w-[18rem] rounded border border-line bg-panel px-2 py-1" />
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark">Search</button>
        {params.q && (
          <Link href="/audit" className="text-accent underline">
            Show all
          </Link>
        )}
      </form>
      {filtered.some((k) => k !== "q") && (
        <p>
          Showing only {filtered.filter((k) => k !== "q").map((k) => `${k} ${params[k]}`).join(", ")}.{" "}
          <Link href="/audit" className="text-accent underline">
            Show all
          </Link>
        </p>
      )}
      <AuditTable params={filters} />
    </div>
  );
}

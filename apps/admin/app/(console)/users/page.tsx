import { requireAdmin } from "@/lib/require-admin";
import { firstParam } from "@/lib/search-params";
import { UsersTable } from "./users-table";

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string | string[]; banned?: string | string[] }> }) {
  await requireAdmin();
  const params = await searchParams;
  const q = firstParam(params.q);
  const banned = firstParam(params.banned);
  const filters: Record<string, string> = {};
  if (q.trim()) filters.q = q.trim();
  if (banned === "true") filters.banned = "true";
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
      <UsersTable params={filters} />
    </div>
  );
}

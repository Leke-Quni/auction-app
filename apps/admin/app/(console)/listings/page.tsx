import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { firstParam } from "@/lib/search-params";
import { ListingsTable } from "./listings-table";

export default async function Listings({ searchParams }: { searchParams: Promise<{ q?: string | string[]; sellerId?: string | string[] }> }) {
  await requireAdmin();
  const params = await searchParams;
  const [q, sellerId] = [firstParam(params.q), firstParam(params.sellerId)];
  const filters: Record<string, string> = {};
  if (q.trim()) filters.q = q.trim();
  if (sellerId.trim()) filters.sellerId = sellerId.trim();
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Listings</h1>
      <form className="flex flex-wrap items-center gap-2">
        {sellerId && <input type="hidden" name="sellerId" value={sellerId} />}
        <input name="q" defaultValue={q} placeholder="Listing id, title or seller" className="w-full max-w-[20rem] rounded border border-line bg-panel px-2 py-1" />
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark">Search</button>
      </form>
      {sellerId && (
        <p>
          Showing only the listings of{" "}
          <Link href={`/users/${sellerId}`} className="text-accent underline">
            one seller
          </Link>
          .{" "}
          <Link href="/listings" className="text-accent underline">
            Show all
          </Link>
        </p>
      )}
      <ListingsTable params={filters} />
    </div>
  );
}

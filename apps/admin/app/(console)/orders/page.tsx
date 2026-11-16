import { ORDER_ATTENTION_KINDS, ORDER_ATTENTION_LABELS } from "@auction/shared";
import { requireAdmin } from "@/lib/require-admin";
import { firstParam } from "@/lib/search-params";
import { OrdersTable } from "./orders-table";

export default async function Orders({ searchParams }: { searchParams: Promise<{ q?: string | string[]; attention?: string | string[] }> }) {
  await requireAdmin();
  const params = await searchParams;
  const [q, attention] = [firstParam(params.q), firstParam(params.attention)];
  const filters: Record<string, string> = {};
  if (q.trim()) filters.q = q.trim();
  if (attention === "any" || (ORDER_ATTENTION_KINDS as readonly string[]).includes(attention)) filters.attention = attention;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Orders</h1>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Order id, listing, invoice, buyer or seller" className="w-full max-w-[20rem] rounded border border-line bg-panel px-2 py-1" />
        <select name="attention" defaultValue={attention} className="rounded border border-line bg-panel px-2 py-1">
          <option value="">Any order</option>
          <option value="any">Needs attention (any)</option>
          {ORDER_ATTENTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {ORDER_ATTENTION_LABELS[k]}
            </option>
          ))}
        </select>
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark">Search</button>
      </form>
      <OrdersTable params={filters} />
    </div>
  );
}

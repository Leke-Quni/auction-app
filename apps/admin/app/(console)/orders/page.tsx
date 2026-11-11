import { formatEur, ORDER_ATTENTION_KINDS, ORDER_ATTENTION_LABELS, type OrderAttentionKind } from "@auction/shared";
import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { STATUS_LABEL, STATUS_PILL, type Status } from "./status";

interface Row {
  id: string;
  status: Status;
  round: number;
  listing: { id: string; title: string };
  buyer: { id: string; username: string };
  seller: { id: string; username: string };
  amountCents: number;
  totalCents: number | null;
  invoiceNumber: string | null;
  shipmentStatus: "LABEL_CREATED" | "IN_TRANSIT" | "DELIVERED" | null;
  createdAt: string;
  attention: OrderAttentionKind | null;
}

const SHIPMENT_LABEL = { LABEL_CREATED: "Label created", IN_TRANSIT: "In transit", DELIVERED: "Delivered" } as const;

export default async function Orders({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; attention?: string }> }) {
  await requireAdmin();
  const { q = "", status = "", attention = "" } = await searchParams;
  const query = new URLSearchParams();
  if (q.trim()) query.set("q", q.trim());
  if (status in STATUS_LABEL) query.set("status", status);
  if (attention === "any" || (ORDER_ATTENTION_KINDS as readonly string[]).includes(attention)) query.set("attention", attention);
  const res = await adminApiFetch(`/admin/orders?${query}`);
  if (!res.ok) throw new Error(`API /admin/orders failed: ${res.status}`);
  const { orders } = (await res.json()) as { orders: Row[] };
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Orders</h1>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Order id, listing, invoice, buyer or seller" className="w-80 rounded border border-line bg-panel px-2 py-1" />
        <select name="status" defaultValue={status} className="rounded border border-line bg-panel px-2 py-1">
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="attention" defaultValue={attention} className="rounded border border-line bg-panel px-2 py-1">
          <option value="">Any order</option>
          <option value="any">Needs attention (any)</option>
          {ORDER_ATTENTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {ORDER_ATTENTION_LABELS[k]}
            </option>
          ))}
        </select>
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-white hover:bg-accent-dark">Search</button>
      </form>
      {orders.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">No orders match.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left">
          <thead className="bg-page text-muted">
            <tr>
              <th className="p-2">Created</th>
              <th className="p-2">Item</th>
              <th className="p-2">Buyer</th>
              <th className="p-2">Seller</th>
              <th className="p-2">Item price</th>
              <th className="p-2">Status</th>
              <th className="p-2">Parcel</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-2 text-muted">{o.createdAt.slice(0, 16).replace("T", " ")}</td>
                <td className="p-2">
                  <Link href={`/orders/${o.id}`} className="text-accent underline">
                    {o.listing.title}
                  </Link>
                  {o.round > 1 && <span className="ml-1 text-xs text-muted">(offer {o.round})</span>}
                  {o.attention && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{ORDER_ATTENTION_LABELS[o.attention]}</span>}
                </td>
                <td className="p-2">@{o.buyer.username}</td>
                <td className="p-2">@{o.seller.username}</td>
                <td className="p-2">{formatEur(o.amountCents)}</td>
                <td className="p-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_PILL[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                </td>
                <td className="p-2 text-muted">{o.shipmentStatus ? SHIPMENT_LABEL[o.shipmentStatus] : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

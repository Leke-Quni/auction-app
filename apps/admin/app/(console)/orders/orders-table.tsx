"use client";

import { formatEur, ORDER_ATTENTION_LABELS, type OrderAttentionKind } from "@auction/shared";
import Link from "next/link";
import { DATE_COLUMN, PRICE_COLUMN } from "@/components/data-table/column-kinds";
import { DataTable, type Column } from "@/components/data-table/data-table";
import { STATUS_LABEL, STATUS_PILL, type Status } from "./status";

interface Row {
  id: string;
  status: Status;
  round: number;
  listing: { id: string; title: string };
  buyer: { id: string; username: string };
  seller: { id: string; username: string };
  sellerSuspended?: boolean;
  amountCents: number;
  shipmentStatus: "LABEL_CREATED" | "IN_TRANSIT" | "DELIVERED" | null;
  createdAt: string;
  attention: OrderAttentionKind | null;
  noteCount: number;
}

const SHIPMENT_LABEL = { LABEL_CREATED: "Label created", IN_TRANSIT: "In transit", DELIVERED: "Delivered" } as const;

const columns: Column<Row>[] = [
  { header: "Created", key: "created", ...DATE_COLUMN,  className: "whitespace-nowrap text-muted", render: (o) => o.createdAt.slice(0, 16).replace("T", " ") },
  {
    header: "Item", key: "item", sortable: true, searchable: true, 
    render: (o) => (
      <>
        <Link href={`/orders/${o.id}`} className="text-accent underline">
          {o.listing.title}
        </Link>
        {o.round > 1 && <span className="ml-1 text-xs text-muted">(offer {o.round})</span>}
        {o.noteCount > 0 && (
          <span className="ml-2 rounded bg-page px-1.5 py-0.5 text-xs text-muted" title="Admin notes on this order">
            {o.noteCount} note{o.noteCount === 1 ? "" : "s"}
          </span>
        )}
        {o.attention && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{ORDER_ATTENTION_LABELS[o.attention]}</span>}
      </>
    ),
  },
  { header: "Buyer", key: "buyer", sortable: true, searchable: true,  render: (o) => `@${o.buyer.username}` },
  { header: "Seller", key: "seller", sortable: true, searchable: true,  render: (o) => `@${o.seller.username}` },
  { header: "Item price", key: "price", ...PRICE_COLUMN,  render: (o) => formatEur(o.amountCents) },
  {
    header: "Status", filterOptions: (Object.keys(STATUS_LABEL) as Status[]).map((value) => ({ value, label: STATUS_LABEL[value] })), key: "status", 
    render: (o) => (
      <>
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_PILL[o.status]}`}>{STATUS_LABEL[o.status]}</span>
        {o.sellerSuspended && <span className="ml-1 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn" title="The seller is banned: this order is paused, and cannot be paid or paid out until the ban is lifted (an unpaid one is cancelled after 7 days)">Seller suspended</span>}
      </>
    ),
  },
  { header: "Parcel", key: "parcel", filterOptions: [{ value: "LABEL_CREATED", label: "Label created" }, { value: "IN_TRANSIT", label: "In transit" }, { value: "DELIVERED", label: "Delivered" }], className: "text-muted", render: (o) => (o.shipmentStatus ? SHIPMENT_LABEL[o.shipmentStatus] : "-") },
];

export function OrdersTable({ params }: { params: Record<string, string> }) {
  return <DataTable<Row> module="orders" rowsField="orders" params={params} columns={columns} rowKey={(o) => o.id} rowClassName="align-top" emptyText="No orders match." />;
}

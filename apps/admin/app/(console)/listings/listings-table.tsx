"use client";

import { formatEur } from "@auction/shared";
import Link from "next/link";
import { COUNT_COLUMN, PRICE_COLUMN } from "@/components/data-table/column-kinds";
import { DataTable, type Column } from "@/components/data-table/data-table";

interface Row {
  id: string;
  title: string;
  phase: "upcoming" | "live" | "ended";
  seller: { id: string; username: string };
  bidCount: number;
  priceCents: number;
  endsAt: string | null;
  outcome: "SOLD" | "NO_SALE" | "NO_BIDS" | null;
  removed: boolean;
}

const PILL = { live: "bg-ok-soft text-ok", upcoming: "bg-warn-soft text-warn", ended: "bg-page text-muted" } as const;
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

const columns: Column<Row>[] = [
  {
    header: "Item", key: "title", sortable: true, searchable: true, 
    render: (l) => (
      <Link href={`/listings/${l.id}`} className="text-accent underline">
        {l.title}
      </Link>
    ),
  },
  {
    header: "Seller", key: "seller", sortable: true, searchable: true, 
    render: (l) => (
      <Link href={`/users/${l.seller.id}`} className="text-accent underline">
        @{l.seller.username}
      </Link>
    ),
  },
  {
    header: "State",
    key: "state",
    filterOptions: [{ value: "upcoming", label: "Upcoming" }, { value: "live", label: "Live" }, { value: "ended", label: "Ended" }, { value: "removed", label: "Removed" }],
    render: (l) => (
      <>
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${PILL[l.phase]}`}>{l.phase}</span>
        {l.removed && <span className="ml-1 rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">removed</span>}
        {l.phase === "ended" && !l.removed && l.outcome && <span className="ml-1 text-xs text-muted">{l.outcome.replace("_", " ").toLowerCase()}</span>}
      </>
    ),
  },
  { header: "Price", key: "price", ...PRICE_COLUMN, className: "whitespace-nowrap", render: (l) => formatEur(l.priceCents) },
  { header: "Bids", key: "bids", ...COUNT_COLUMN, render: (l) => l.bidCount },
  { header: "Ends", sortLabels: { asc: "Ending soonest", desc: "Ending latest" }, key: "ends", sortable: true,  className: "whitespace-nowrap text-muted", render: (l) => (l.endsAt ? when(l.endsAt) : "") },
];

export function ListingsTable({ params }: { params: Record<string, string> }) {
  return <DataTable<Row> module="listings" rowsField="listings" params={params} columns={columns} rowKey={(l) => l.id} rowClassName="align-top" emptyText="No listings match. Drafts are not shown." />;
}

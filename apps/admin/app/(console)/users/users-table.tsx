"use client";

import Link from "next/link";
import { COUNT_COLUMN, DATE_COLUMN } from "@/components/data-table/column-kinds";
import { DataTable, type Column } from "@/components/data-table/data-table";

interface UserRow {
  id: string;
  username: string;
  email: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  bannedAt: string | null;
  strikeCount: number;
  listingCount: number;
  bidCount: number;
}

const day = (iso: string) => iso.slice(0, 10);

const columns: Column<UserRow>[] = [
  {
    header: "Username", key: "username", sortable: true, searchable: true, 
    render: (u) => (
      <>
        <Link href={`/users/${u.id}`} className="text-accent underline">
          @{u.username}
        </Link>
        {u.role === "ADMIN" && <span className="ml-1 rounded bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info">admin</span>}
      </>
    ),
  },
  { header: "Email", key: "email", sortable: true, searchable: true,  render: (u) => u.email },
  { header: "Joined", key: "joined", ...DATE_COLUMN, render: (u) => <span className="text-muted">{day(u.createdAt)}</span> },
  { header: "Listings", key: "listings", ...COUNT_COLUMN, render: (u) => u.listingCount },
  { header: "Bids", key: "bids", ...COUNT_COLUMN, render: (u) => u.bidCount },
  { header: "Strikes", key: "strikes", ...COUNT_COLUMN, render: (u) => u.strikeCount },
  {
    header: "Status", key: "status", filterOptions: [{ value: "active", label: "Active" }, { value: "banned", label: "Banned" }],
    render: (u) => (u.bannedAt ? <span className="rounded bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">banned</span> : <span className="text-muted">active</span>),
  },
];

export function UsersTable({ params }: { params: Record<string, string> }) {
  return <DataTable<UserRow> module="users" rowsField="users" params={params} columns={columns} rowKey={(u) => u.id} emptyText="No accounts match." />;
}

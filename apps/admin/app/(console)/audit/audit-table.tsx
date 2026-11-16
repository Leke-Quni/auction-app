"use client";

import Link from "next/link";
import { DATE_COLUMN } from "@/components/data-table/column-kinds";
import { DataTable, type Column } from "@/components/data-table/data-table";

type Action = keyof typeof LABEL;

interface Entry {
  id: string;
  action: Action;
  targetId: string;
  reason: string | null;
  createdAt: string;
  admin: { id: string; username: string | null };
}

const LABEL = { BAN_USER: "Banned a user", UNBAN_USER: "Restored a user", CLEAR_STRIKE: "Cleared a strike", REMOVE_LISTING: "Removed a listing", VIEW_ORDER: "Opened an order", REMOVE_POST: "Removed a question or answer", SET_ROLE: "Changed an admin role", STRIKE_USER: "Gave a strike", VIEW_INVOICE: "Opened an invoice", HANDLE_SUPPORT: "Closed a support request", ADD_ORDER_NOTE: "Added an order note", RESEND_ORDER_EMAIL: "Sent an order email again" } as const;
const HREF = { BAN_USER: "/users", UNBAN_USER: "/users", CLEAR_STRIKE: "/users", REMOVE_LISTING: "/listings", VIEW_ORDER: "/orders", REMOVE_POST: "/question-log?questionId=", SET_ROLE: "/users", STRIKE_USER: "/users", VIEW_INVOICE: "/orders", HANDLE_SUPPORT: "/support", ADD_ORDER_NOTE: "/orders", RESEND_ORDER_EMAIL: "/orders" } as const;
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";

const columns: Column<Entry>[] = [
  { header: "When", key: "when", ...DATE_COLUMN, className: "whitespace-nowrap text-muted", render: (e) => when(e.createdAt) },
  {
    header: "Admin", key: "admin", searchable: true, 
    render: (e) =>
      e.admin.username ? (
        <Link href={`/users/${encodeURIComponent(e.admin.id)}`} className="text-accent underline">
          @{e.admin.username}
        </Link>
      ) : (
        "deleted user"
      ),
  },
  { header: "What", key: "action", filterOptions: (Object.keys(LABEL) as Action[]).map((value) => ({ value, label: LABEL[value] })), render: (e) => LABEL[e.action] },
  {
    header: "Target", key: "target", sortable: true, searchable: true, 
    render: (e) => (
      <Link href={e.action === "HANDLE_SUPPORT" ? "/support?status=HANDLED" : e.action === "REMOVE_POST" ? `${HREF[e.action]}${encodeURIComponent(e.targetId)}` : `${HREF[e.action]}/${encodeURIComponent(e.targetId)}`} className="text-accent underline">
        {e.targetId}
      </Link>
    ),
  },
  {
    header: "Reason", key: "reason", sortable: true, searchable: true, 
    className: "max-w-md whitespace-pre-wrap break-words",
    render: (e) => (e.action === "ADD_ORDER_NOTE" ? "" : e.action === "CLEAR_STRIKE" ? <span className="text-muted">strike {e.reason}</span> : e.action === "VIEW_INVOICE" ? <span className="text-muted">{e.reason === "seller" ? "seller's statement" : "buyer's invoice"}</span> : e.action === "SET_ROLE" ? <span className="text-muted">now {e.reason === "ADMIN" ? "an admin" : "an ordinary user"}</span> : (e.reason ?? "")),
  },
];

export function AuditTable({ params }: { params: Record<string, string> }) {
  return <DataTable<Entry> module="audit" rowsField="entries" params={params} columns={columns} rowKey={(e) => e.id} rowClassName="align-top" emptyText={params.q ? "No entries for that admin." : "No entries."} />;
}

import { REPORT_REASON_LABELS, type ReportReason } from "@auction/shared";
import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { RemovePostForm } from "./remove-post-form";
import { StrikeRemoveForm } from "./strike-remove-form";
import { handleReportAction, removePostAction, strikeAndRemoveAction } from "./actions";

interface Person {
  id: string;
  username: string | null;
}
interface Report {
  id: string;
  status: "OPEN" | "HANDLED";
  reason: ReportReason;
  target: "QUESTION" | "ANSWER";
  body: string;
  postedAt: string;
  createdAt: string;
  handledAt: string | null;
  questionId: string;
  listing: { id: string; title: string } | null;
  reporter: Person | null;
  author: Person | null;
}

const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const who = (p: Person | null, none: string) =>
  p ? (
    p.username ? (
      <Link href={`/users/${p.id}`} className="text-accent underline">
        @{p.username}
      </Link>
    ) : (
      "deleted user"
    )
  ) : (
    none
  );

export default async function Reports({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const status = (await searchParams).status === "HANDLED" ? "HANDLED" : "OPEN";
  const res = await adminApiFetch(`/admin/reports?status=${status}`);
  if (!res.ok) throw new Error(`API /admin/reports failed: ${res.status}`);
  const { reports, openCount } = (await res.json()) as { reports: Report[]; openCount: number };
  const tab = (value: "OPEN" | "HANDLED", label: string) => (
    <Link href={value === "OPEN" ? "/reports" : "/reports?status=HANDLED"} aria-current={status === value ? "page" : undefined} className={`rounded px-3 py-1 ${status === value ? "bg-accent font-semibold text-white" : "border border-line bg-panel hover:bg-page"}`}>
      {label}
    </Link>
  );
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Reports</h1>
      <div className="flex gap-2">
        {tab("OPEN", `Open (${openCount})`)}
        {tab("HANDLED", "Handled")}
      </div>
      {reports.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">{status === "OPEN" ? "No open reports." : "No handled reports. They are removed 30 days after the auction ends."}</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left">
          <thead className="bg-page text-muted">
            <tr>
              <th className="p-2">Reason</th>
              <th className="p-2">Words as written</th>
              <th className="p-2">Written by</th>
              <th className="p-2">Reported by</th>
              <th className="p-2">Listing</th>
              <th className="p-2">{status === "OPEN" ? "Reported" : "Handled"}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="p-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.reason === "CONTACT_DETAILS" ? "bg-warn-soft text-warn" : "bg-info-soft text-info"}`}>{REPORT_REASON_LABELS[r.reason]}</span>
                  <div className="mt-1 text-xs text-muted">{r.target === "QUESTION" ? "Question" : "Answer"}</div>
                </td>
                <td className="max-w-md whitespace-pre-wrap break-words p-2">{r.body}</td>
                <td className="p-2">{who(r.author, "gone")}</td>
                <td className="p-2">{r.reporter ? who(r.reporter, "") : <span className="text-muted">Flagged by the site</span>}</td>
                <td className="p-2">{r.listing ? (
                    <Link href={`/listings/${r.listing.id}`} className="text-accent underline">
                      {r.listing.title}
                    </Link>
                  ) : (
                    <span className="text-muted">removed</span>
                  )}</td>
                <td className="whitespace-nowrap p-2 text-muted">{when(status === "OPEN" ? r.createdAt : (r.handledAt ?? r.createdAt))}</td>
                <td className="p-2 text-right">
                  <div className="flex flex-wrap items-start justify-end gap-2">
                    <Link href={`/question-log?questionId=${r.questionId}`} className="text-accent underline">
                      Log
                    </Link>
                    {r.status === "OPEN" && r.author?.username && <StrikeRemoveForm action={strikeAndRemoveAction} id={r.id} username={r.author.username} what={r.target === "QUESTION" ? "question" : "answer"} />}
                    {r.status === "OPEN" && (
                      <RemovePostForm action={removePostAction} id={r.id} what={r.target === "QUESTION" ? "question" : "answer"} />
                    )}
                    {r.status === "OPEN" && (
                      <form action={handleReportAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="cursor-pointer rounded bg-accent px-2 py-0.5 font-semibold text-white hover:bg-accent-dark">Mark handled</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

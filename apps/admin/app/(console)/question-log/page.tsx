import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";

interface Entry {
  id: string;
  questionId: string;
  listingId: string;
  target: "QUESTION" | "ANSWER";
  action: "CREATED" | "EDITED" | "DELETED";
  body: string;
  previousBody: string | null;
  createdAt: string;
  actor: { id: string; username: string | null } | null;
}

const FILTERS = ["questionId", "listingId", "actorId"] as const;
const PILL = { CREATED: "bg-ok-soft text-ok", EDITED: "bg-warn-soft text-warn", DELETED: "bg-danger-soft text-danger" } as const;
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";

export default async function QuestionLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of FILTERS) if (params[key]) query.set(key, params[key]!);
  const res = await adminApiFetch(`/admin/question-log?${query}`);
  if (!res.ok) throw new Error(`API /admin/question-log failed: ${res.status}`);
  const { entries } = (await res.json()) as { entries: Entry[] };
  const filtered = FILTERS.filter((k) => params[k]);
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Question log</h1>
      <p className="text-muted">Every question and answer as written, every edit and every deletion, newest first. Entries go 30 days after the auction ends.</p>
      {filtered.length > 0 && (
        <p>
          Showing only {filtered.map((k) => `${k} ${params[k]}`).join(", ")}.{" "}
          <Link href="/question-log" className="text-accent underline">
            Show all
          </Link>
        </p>
      )}
      {entries.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">No entries.</p>
      ) : (
        <table className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left">
          <thead className="bg-page text-muted">
            <tr>
              <th className="p-2">When</th>
              <th className="p-2">What</th>
              <th className="p-2">By</th>
              <th className="p-2">Words</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-2 text-muted">{when(e.createdAt)}</td>
                <td className="p-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${PILL[e.action]}`}>{e.action.toLowerCase()}</span>
                  <div className="mt-1 text-xs text-muted">{e.target === "QUESTION" ? "Question" : "Answer"}</div>
                </td>
                <td className="p-2">{e.actor ? (e.actor.username ? `@${e.actor.username}` : "deleted user") : <span className="text-muted">unknown</span>}</td>
                <td className="max-w-lg whitespace-pre-wrap break-words p-2">
                  {e.body}
                  {e.previousBody !== null && <div className="mt-1 text-xs text-muted">Before: {e.previousBody}</div>}
                </td>
                <td className="p-2 text-right">
                  <Link href={`/question-log?questionId=${e.questionId}`} className="text-accent underline">
                    This question
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

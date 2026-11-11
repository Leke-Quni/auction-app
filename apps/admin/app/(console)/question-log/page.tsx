import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { removeQuestionPostAction } from "./actions";
import { RemoveButton } from "./remove-button";

interface Entry {
  id: string;
  questionId: string;
  listingId: string;
  listing: { id: string; title: string } | null;
  target: "QUESTION" | "ANSWER";
  action: "CREATED" | "EDITED" | "DELETED";
  body: string;
  previousBody: string | null;
  createdAt: string;
  actor: { id: string; username: string | null } | null;
}

const FILTERS = ["questionId", "listingId", "actorId"] as const;
const PILL = { CREATED: "bg-ok-soft text-ok", EDITED: "bg-warn-soft text-warn", DELETED: "bg-danger-soft text-danger" } as const;
const VERB = { CREATED: "wrote", EDITED: "edited", DELETED: "deleted" } as const;
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
const RECENT = 30;

// Entries come newest first. A conversation is one question's entries, oldest first; conversations sit under their listing,
// listings ordered by their latest activity.
function conversations(entries: Entry[]) {
  const listings = new Map<string, { listing: Entry["listing"]; listingId: string; threads: Map<string, Entry[]> }>();
  for (const e of entries) {
    const group = listings.get(e.listingId) ?? { listing: e.listing, listingId: e.listingId, threads: new Map() };
    group.threads.set(e.questionId, [e, ...(group.threads.get(e.questionId) ?? [])]);
    listings.set(e.listingId, group);
  }
  return [...listings.values()];
}

export default async function QuestionLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const filtered = FILTERS.filter((k) => params[k]);
  const query = new URLSearchParams();
  for (const key of FILTERS) if (params[key]) query.set(key, params[key]!);
  if (q) query.set("q", q);
  const searching = q !== "" || filtered.length > 0;
  if (!searching) query.set("limit", String(RECENT));
  const res = await adminApiFetch(`/admin/question-log?${query}`);
  if (!res.ok) throw new Error(`API /admin/question-log failed: ${res.status}`);
  const { entries, questions } = (await res.json()) as { entries: Entry[]; questions: Record<string, { questionUp: boolean; answerUp: boolean; questionVersion: string; answerVersion: string }> };
  const groups = conversations(entries);
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Question log</h1>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Username, email, listing title or id" className="w-96 rounded border border-line bg-panel px-2 py-1" />
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark">Search</button>
      </form>
      <p className="text-muted">
        {searching
          ? "Everything said in the conversations that match, oldest first. Edits show the words before, and deleted words stay here until 30 days after the auction ends."
          : `Search for a person or a listing to read their conversations. Until then, the ${RECENT} latest entries.`}
      </p>
      {filtered.length > 0 && (
        <p>
          Showing only {filtered.map((k) => `${k} ${params[k]}`).join(", ")}.{" "}
          <Link href="/question-log" className="text-accent underline">
            Show all
          </Link>
        </p>
      )}
      {groups.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">{searching ? "Nothing matches." : "No entries."}</p>
      ) : (
        groups.map((g) => (
          <section key={g.listingId} className="rounded border border-line bg-panel">
            <h2 className="border-b border-line bg-page p-2 font-bold">
              {g.listing ? (
                <Link href={`/listings/${g.listing.id}`} className="text-accent underline">
                  {g.listing.title}
                </Link>
              ) : (
                <span className="text-muted">A removed listing</span>
              )}
            </h2>
            <div className="divide-y divide-line">
              {[...g.threads.entries()].map(([questionId, thread]) => (
                <ol key={questionId} className="space-y-2 p-3">
                  {thread.map((e) => (
                    <li key={e.id} className="grid grid-cols-[11rem_1fr] gap-3">
                      <span className="text-xs text-muted">{when(e.createdAt)}</span>
                      <div className={e.target === "ANSWER" ? "ml-6" : ""}>
                        <p className="text-xs text-muted">
                          {e.actor ? (
                            e.actor.username ? (
                              <Link href={`/users/${e.actor.id}`} className="text-accent underline">
                                @{e.actor.username}
                              </Link>
                            ) : (
                              "a deleted user"
                            )
                          ) : (
                            "unknown"
                          )}{" "}
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${PILL[e.action]}`}>
                            {VERB[e.action]} {e.target === "QUESTION" ? "a question" : "an answer"}
                          </span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words">{e.body}</p>
                        {e.previousBody !== null && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted">Before: {e.previousBody}</p>}
                      </div>
                    </li>
                  ))}
                  {(questions[questionId]?.questionUp || questions[questionId]?.answerUp) && (
                    <li className="flex gap-2 pt-1">
                      {questions[questionId]?.answerUp && <RemoveButton action={removeQuestionPostAction} id={questionId} target="ANSWER" version={questions[questionId]!.answerVersion} />}
                      {questions[questionId]?.questionUp && <RemoveButton action={removeQuestionPostAction} id={questionId} target="QUESTION" version={questions[questionId]!.questionVersion} />}
                    </li>
                  )}
                </ol>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

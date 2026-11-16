"use client";

import Link from "next/link";
import { Pagination } from "@/components/data-table/pagination";
import { PAGE_SIZE } from "@/components/data-table/page-window";
import { usePagedList } from "@/components/data-table/use-paged-list";
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

interface Body {
  entries: Entry[];
  questions: Record<string, { questionUp: boolean; answerUp: boolean; questionVersion: string; answerVersion: string }>;
}

const PILL = { CREATED: "bg-ok-soft text-ok", EDITED: "bg-warn-soft text-warn", DELETED: "bg-danger-soft text-danger" } as const;
const VERB = { CREATED: "wrote", EDITED: "edited", DELETED: "deleted" } as const;
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";

// Entries come newest first. A conversation is one question's entries on this page, oldest first; conversations sit under their
// listing, listings ordered by their latest activity.
function conversations(entries: Entry[]) {
  const listings = new Map<string, { listing: Entry["listing"]; listingId: string; threads: Map<string, Entry[]> }>();
  for (const e of entries) {
    const group = listings.get(e.listingId) ?? { listing: e.listing, listingId: e.listingId, threads: new Map() };
    group.threads.set(e.questionId, [e, ...(group.threads.get(e.questionId) ?? [])]);
    listings.set(e.listingId, group);
  }
  return [...listings.values()];
}

export function QuestionLogList({ params, searching }: { params: Record<string, string>; searching: boolean }) {
  const { state, busy, page, goTo, reload } = usePagedList<Body>("question-log", params);

  if (state.status === "loading")
    return (
      <div className="space-y-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <section key={i} className="rounded border border-line bg-panel" aria-hidden>
            <div className="border-b border-line bg-page p-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
            </div>
            <div className="space-y-2 p-3">
              {[0, 1].map((j) => (
                <div key={j} className="h-4 w-3/4 animate-pulse rounded bg-page" />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  if (state.status === "error")
    return (
      <p className="rounded border border-line bg-panel p-4 text-danger">
        Could not load the log.{" "}
        <button type="button" onClick={reload} className="cursor-pointer text-accent underline">
          Try again
        </button>
      </p>
    );

  const { entries, questions, total } = state.body;
  const groups = conversations(entries);
  // After a removal the list is loaded again, so the buttons and the deleted words are the current ones.
  const remove = async (formData: FormData) => {
    await removeQuestionPostAction(formData);
    reload();
  };
  return (
    <div className="space-y-3">
      {groups.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">{searching ? "Nothing matches." : "No entries."}</p>
      ) : (
        <div className={`space-y-3 ${busy ? "opacity-50 transition-opacity" : ""}`}>
          {groups.map((g) => (
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
                      <li key={e.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
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
                        {questions[questionId]?.answerUp && <RemoveButton action={remove} id={questionId} target="ANSWER" version={questions[questionId]!.answerVersion} />}
                        {questions[questionId]?.questionUp && <RemoveButton action={remove} id={questionId} target="QUESTION" version={questions[questionId]!.questionVersion} />}
                      </li>
                    )}
                  </ol>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {total > 0 && <Pagination page={Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)))} total={total} onPage={goTo} />}
    </div>
  );
}

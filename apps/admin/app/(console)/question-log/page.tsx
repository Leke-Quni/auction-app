import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { firstParam } from "@/lib/search-params";
import { QuestionLogList } from "./question-log-list";

const FILTERS = ["questionId", "listingId", "actorId"] as const;

export default async function QuestionLog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const q = firstParam(params.q).trim();
  const filtered = FILTERS.filter((k) => params[k]);
  const filters: Record<string, string> = {};
  for (const key of FILTERS) if (params[key]) filters[key] = firstParam(params[key]);
  if (q) filters.q = q;
  const searching = q !== "" || filtered.length > 0;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Question log</h1>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Username, email, listing title or id" className="w-full max-w-[24rem] rounded border border-line bg-panel px-2 py-1" />
        <button className="cursor-pointer rounded bg-accent px-3 py-1 font-semibold text-on-brand hover:bg-accent-dark">Search</button>
      </form>
      <p className="text-muted">
        {searching
          ? "Everything said in the conversations that match, oldest first. Edits show the words before, and deleted words stay here until 30 days after the auction ends."
          : "Search for a person or a listing to read their conversations. Until then, every entry, newest first."}
      </p>
      {filtered.length > 0 && (
        <p>
          Showing only {filtered.map((k) => `${k} ${params[k]}`).join(", ")}.{" "}
          <Link href="/question-log" className="text-accent underline">
            Show all
          </Link>
        </p>
      )}
      <QuestionLogList params={filters} searching={searching} />
    </div>
  );
}

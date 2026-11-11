import Link from "next/link";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { clearStrikeAndCloseAction, handleSupportAction, liftBanAndCloseAction } from "./actions";
import { ConfirmForm } from "./confirm-form";
import { ReplyButton } from "./reply-button";

interface Request {
  id: string;
  kind: "GENERAL" | "STRIKE_APPEAL" | "BAN_APPEAL";
  status: "OPEN" | "HANDLED";
  message: string;
  createdAt: string;
  handledAt: string | null;
  repliedAt?: string | null;
  user: { id: string; username: string; email: string; strikeCount: number; banned: boolean; banReason: string | null };
  strike: { id: string; createdAt: string; reason: string | null; givenByAdmin: boolean; listingTitle: string | null } | null;
}

const KIND_LABEL = { GENERAL: "question", STRIKE_APPEAL: "strike appeal", BAN_APPEAL: "suspension appeal" } as const;

// Opens the admin's own mail program with a reply to the person: their address, a subject and their words quoted below (cut short, because
// a link much over 2,000 characters is refused by some mail programs).
const replyHref = (r: Request) => {
  const quoted = r.message.slice(0, 500).split("\n").map((line) => `> ${line}`).join("\n");
  const body = `Hi @${r.user.username},\n\n\n\nOn ${when(r.createdAt).slice(0, 10)} you wrote:\n${quoted}${r.message.length > 500 ? "\n> ..." : ""}`;
  return `mailto:${r.user.email}?subject=${encodeURIComponent(`Re: your ${KIND_LABEL[r.kind]} to support`)}&body=${encodeURIComponent(body)}`;
};

const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function Support({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const status = (await searchParams).status === "HANDLED" ? "HANDLED" : "OPEN";
  const res = await adminApiFetch(`/admin/support?status=${status}`);
  if (!res.ok) throw new Error(`API /admin/support failed: ${res.status}`);
  const { requests, openCount } = (await res.json()) as { requests: Request[]; openCount: number };
  const tab = (value: "OPEN" | "HANDLED", label: string) => (
    <Link href={value === "OPEN" ? "/support" : "/support?status=HANDLED"} aria-current={status === value ? "page" : undefined} className={`rounded px-3 py-1 ${status === value ? "bg-accent font-semibold text-on-brand" : "border border-line bg-panel hover:bg-page"}`}>
      {label}
    </Link>
  );
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Support</h1>
      <p className="text-muted">Questions, strike appeals and ban appeals (written from the suspended page) sent through the support form. Strike appeals email the person when you clear the strike or refuse; for a question, answer by email to the address shown, then close the request here.</p>
      <div className="flex gap-2">
        {tab("OPEN", `Open (${openCount})`)}
        {tab("HANDLED", "Handled")}
      </div>
      {requests.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-muted">{status === "OPEN" ? "Nothing waiting." : "Nothing handled yet."}</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="space-y-2 rounded border border-line bg-panel p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.kind === "GENERAL" ? "bg-info-soft text-info" : "bg-warn-soft text-warn"}`}>{r.kind === "STRIKE_APPEAL" ? "Strike appeal" : r.kind === "BAN_APPEAL" ? "Ban appeal" : "Question"}</span>{" "}
                  <Link href={`/users/${r.user.id}`} className="text-accent underline">
                    @{r.user.username}
                  </Link>{" "}
                  <a href={`mailto:${r.user.email}`} className="text-accent underline">
                    {r.user.email}
                  </a>{" "}
                  <span className="text-muted">{when(status === "OPEN" ? r.createdAt : (r.handledAt ?? r.createdAt))}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {r.status === "OPEN" && (
                    <>
                    <ReplyButton id={r.id} href={replyHref(r)} email={r.user.email} repliedAt={r.repliedAt} />
                    {r.kind === "STRIKE_APPEAL" && r.strike && <ConfirmForm action={clearStrikeAndCloseAction} fields={{ id: r.id, strikeId: r.strike.id }} label="Clear the strike and close" confirm={`Clear this strike for @${r.user.username} and close the request? They are emailed that it was accepted.`} tone="primary" />}
                    {r.kind === "BAN_APPEAL" && r.user.banned && <ConfirmForm action={liftBanAndCloseAction} fields={{ id: r.id }} label="Unban and close" confirm={`Lift the ban on @${r.user.username} and close the request? They are emailed that their account was restored.`} tone="primary" />}
                    <ConfirmForm action={handleSupportAction} fields={{ id: r.id }} label={r.kind === "STRIKE_APPEAL" && r.strike ? "Refuse and close" : r.kind === "BAN_APPEAL" && r.user.banned ? "Refuse and close" : "Mark handled"} confirm={(r.kind === "STRIKE_APPEAL" && r.strike) || (r.kind === "BAN_APPEAL" && r.user.banned) ? "Refuse this appeal and close the request? They are emailed that it was denied." : "Close this request? They are not emailed: write to them yourself."} tone="plain" />
                    </>
                  )}
                </div>
              </div>
              {r.kind === "BAN_APPEAL" && (
                <p className="rounded bg-page p-2 text-muted">
                  {r.user.banned ? `Banned. Reason: ${r.user.banReason ?? "none given"}.` : "This account is not banned any more."} "Unban and close" lifts it and emails the person that their account was restored.
                </p>
              )}
              {r.kind === "STRIKE_APPEAL" && (
                <p className="rounded bg-page p-2 text-muted">
                  {r.strike ? (
                    <>
                      The strike ({when(r.strike.createdAt)}): {r.strike.givenByAdmin ? "given by an admin" : `did not pay for ${r.strike.listingTitle ?? "an auction"}`}
                      {r.strike.reason ? `. ${r.strike.reason}` : ""} They have {r.user.strikeCount} strike{r.user.strikeCount === 1 ? "" : "s"} in all.
                    </>
                  ) : (
                    "That strike has been cleared already."
                  )}
                </p>
              )}
              <p className="whitespace-pre-wrap break-words">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import type { SupportStrike } from "@auction/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { sendSupportAction, type SupportState } from "./actions";

const when = (iso: string) => new Date(iso).toISOString().slice(0, 10);

// One form for both: a question, or an appeal against one of the person's strikes (picked from their own list).
// It sends with its own handler instead of `<form action>`, which resets every field when the answer comes back (even an error):
// the radio then jumped back to "A question" while the strike list and the "Why should it be cleared?" box stayed, and the message was lost.
// `waiting`: a message of theirs has not been answered yet, so they cannot send another (the API refuses it too).
export function SupportForm({ strikes, startWithAppeal, waiting, email }: { strikes: SupportStrike[]; startWithAppeal: boolean; waiting: boolean; email: string }) {
  const router = useRouter();
  const [state, setState] = useState<SupportState>({});
  const [pending, startTransition] = useTransition();
  const open = strikes.filter((s) => !s.appealed);
  const [wanted, setWanted] = useState<"GENERAL" | "STRIKE_APPEAL">(startWithAppeal ? "STRIKE_APPEAL" : "GENERAL");
  const [strikeId, setStrikeId] = useState(open[0]?.id ?? "");
  const [message, setMessage] = useState("");
  // A strike with an appeal already waiting cannot be appealed again, so with none left the form is a plain question.
  const kind = open.length === 0 ? "GENERAL" : wanted;
  const chosen = open.find((s) => s.id === strikeId) ?? open[0];

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await sendSupportAction({}, data);
      setState(result);
      if (result.ok) setMessage("");
      // The list of strikes may have changed (an appeal now waiting), so ask the page for it again.
      router.refresh();
    });
  };

  return (
    <form onSubmit={send} className="space-y-3 border border-line bg-surface p-4">
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted">What is it about?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="GENERAL" checked={kind === "GENERAL"} onChange={() => setWanted("GENERAL")} /> A question or problem
        </label>
        <label className={`flex items-center gap-2 ${open.length === 0 ? "text-muted" : ""}`}>
          <input type="radio" name="kind" value="STRIKE_APPEAL" checked={kind === "STRIKE_APPEAL"} disabled={open.length === 0} onChange={() => setWanted("STRIKE_APPEAL")} /> Appeal a strike
          {strikes.length === 0 && <span className="text-xs">(you have none)</span>}
          {strikes.length > 0 && open.length === 0 && <span className="text-xs">(your appeal was sent, we will answer by email)</span>}
        </label>
      </fieldset>
      {kind === "STRIKE_APPEAL" && (
        <label className="block">
          <span className="text-xs text-muted">Which strike?</span>
          <select name="strikeId" required value={chosen?.id ?? ""} onChange={(e) => setStrikeId(e.target.value)} className="mt-1 w-full border border-field bg-surface p-1.5 text-sm">
            {strikes.map((s) => (
              <option key={s.id} value={s.id} disabled={s.appealed}>
                {when(s.createdAt)}: {s.givenByAdmin ? `given by an admin${s.reason ? ` (${s.reason.slice(0, 60)})` : ""}` : `did not pay for ${s.listingTitle ?? "an auction"}`}
                {s.appealed ? " - appeal sent" : ""}
              </option>
            ))}
          </select>
          {chosen && (
            <div className="mt-2 space-y-1 border border-line bg-soft p-2 text-sm" data-testid="strike-details">
              <p className="font-bold">The strike you are appealing</p>
              <p>Given on {when(chosen.createdAt)}</p>
              {chosen.givenByAdmin ? (
                <>
                  <p>Given by an admin{chosen.listingTitle ? ` about "${chosen.listingTitle}"` : ""}.</p>
                  {chosen.reason && <p className="whitespace-pre-wrap break-words">Reason: {chosen.reason}</p>}
                </>
              ) : (
                <p>You did not pay for {chosen.listingTitle ? `"${chosen.listingTitle}"` : "an auction"} within 48 hours of winning it.</p>
              )}
            </div>
          )}
        </label>
      )}
      <label className="block">
        <span className="text-xs text-muted">{kind === "STRIKE_APPEAL" ? "Why should it be cleared?" : "Your message"}</span>
        <textarea name="message" required maxLength={2000} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 w-full border border-field bg-surface p-1.5 text-sm" />
      </label>
      {waiting && !state.ok && (
        <p role="status" className="border border-line bg-soft p-2">
          You have a message waiting for an answer. We will answer by email, and then you can write again.
        </p>
      )}
      {state.error && <p className="text-urgent">{state.error}</p>}
      {state.ok && <p className="text-brand">{state.ok}</p>}
      <p className="text-xs text-muted">We answer by email, to {email}.</p>
      <button disabled={pending || waiting || Boolean(state.ok)} className="cursor-pointer bg-brand px-4 py-2 font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Sending..." : "Send"}
      </button>
    </form>
  );
}

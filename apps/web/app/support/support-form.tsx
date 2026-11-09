"use client";

import type { SupportStrike } from "@auction/shared";
import { useActionState, useState } from "react";
import { sendSupportAction, type SupportState } from "./actions";

const when = (iso: string) => new Date(iso).toISOString().slice(0, 10);

// One form for both: a question, or an appeal against one of the person's strikes (picked from their own list).
export function SupportForm({ strikes, startWithAppeal, email }: { strikes: SupportStrike[]; startWithAppeal: boolean; email: string }) {
  const [state, action, pending] = useActionState<SupportState, FormData>(sendSupportAction, {});
  const open = strikes.filter((s) => !s.appealed);
  const [kind, setKind] = useState<"GENERAL" | "STRIKE_APPEAL">(startWithAppeal && open.length > 0 ? "STRIKE_APPEAL" : "GENERAL");
  const [strikeId, setStrikeId] = useState(open[0]?.id ?? "");
  const chosen = strikes.find((s) => s.id === strikeId);
  return (
    <form action={action} className="space-y-3 border border-line bg-white p-4">
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted">What is it about?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="GENERAL" checked={kind === "GENERAL"} onChange={() => setKind("GENERAL")} /> A question or problem
        </label>
        <label className={`flex items-center gap-2 ${strikes.length === 0 ? "text-muted" : ""}`}>
          <input type="radio" name="kind" value="STRIKE_APPEAL" checked={kind === "STRIKE_APPEAL"} disabled={strikes.length === 0} onChange={() => setKind("STRIKE_APPEAL")} /> Appeal a strike
          {strikes.length === 0 && <span className="text-xs">(you have none)</span>}
        </label>
      </fieldset>
      {kind === "STRIKE_APPEAL" && (
        <label className="block">
          <span className="text-xs text-muted">Which strike?</span>
          <select name="strikeId" required value={strikeId} onChange={(e) => setStrikeId(e.target.value)} className="mt-1 w-full border border-[#888] bg-white p-1.5 text-sm">
            {strikes.map((s) => (
              <option key={s.id} value={s.id} disabled={s.appealed}>
                {when(s.createdAt)}: {s.givenByAdmin ? `given by an admin${s.reason ? ` (${s.reason.slice(0, 60)})` : ""}` : `did not pay for ${s.listingTitle ?? "an auction"}`}
                {s.appealed ? " - appeal sent" : ""}
              </option>
            ))}
          </select>
          {chosen && (
            <div className="mt-2 space-y-1 border border-line bg-[#f7f7f7] p-2 text-sm" data-testid="strike-details">
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
        <textarea name="message" required maxLength={2000} rows={6} className="mt-1 w-full border border-[#888] bg-white p-1.5 text-sm" />
      </label>
      {state.error && <p className="text-urgent">{state.error}</p>}
      {state.ok && <p className="text-brand">{state.ok}</p>}
      <p className="text-xs text-muted">We answer by email, to {email}.</p>
      <button disabled={pending} className="cursor-pointer bg-brand px-4 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Sending..." : "Send"}
      </button>
    </form>
  );
}

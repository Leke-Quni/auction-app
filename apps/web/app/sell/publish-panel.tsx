"use client";

import { MAX_SCHEDULE_AHEAD_DAYS } from "@auction/shared";
import { useState, useTransition } from "react";
import { deleteListingAction, publishListingAction } from "./actions";

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function PublishPanel({ listingId, photoCount, durationDays }: { listingId: string; photoCount: number; durationDays: number }) {
  const [when, setWhen] = useState<"now" | "later">("now");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const publish = () => {
    setError("");
    if (when === "later" && !startsAt) return setError("Choose a start time");
    startTransition(async () => {
      const result = await publishListingAction(listingId, when === "later" ? new Date(startsAt).toISOString() : undefined);
      if (result?.error) setError(result.error);
    });
  };

  const remove = () => {
    if (!confirm("Delete this draft and its photos?")) return;
    startTransition(async () => {
      const result = await deleteListingAction(listingId);
      if (result?.error) setError(result.error);
    });
  };

  const now = new Date();
  return (
    <div className="space-y-2 border border-line bg-white p-3">
      <h2 className="text-sm font-bold">Publish</h2>
      <p className="text-xs text-muted">
        Publishing starts a {durationDays}-day auction. After that, only the description and photos can change.
      </p>
      <label className="flex items-center gap-2">
        <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> Start now
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule a start
      </label>
      {when === "later" && (
        <input
          type="datetime-local"
          aria-label="Start time"
          value={startsAt}
          min={toLocalInput(now)}
          max={toLocalInput(new Date(now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000))}
          onChange={(e) => setStartsAt(e.target.value)}
          className="border border-[#888] bg-white p-1.5 text-sm"
        />
      )}
      {photoCount === 0 && <p className="text-xs text-muted">Add at least one photo to publish.</p>}
      {error && <p className="text-urgent">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={publish}
          disabled={pending || photoCount === 0}
          className="cursor-pointer bg-brand px-3 py-1 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "..." : "Publish"}
        </button>
        <button onClick={remove} disabled={pending} className="cursor-pointer border border-[#888] bg-white px-3 py-1">
          Delete draft
        </button>
      </div>
    </div>
  );
}

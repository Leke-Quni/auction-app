"use client";

import { MAX_SCHEDULE_AHEAD_DAYS } from "@auction/shared";
import { useEffect, useState, useTransition } from "react";
import { LISTING_FORM_ID, LISTING_FORM_STATUS_ID, flagIncompleteForPublish } from "./listing-form";
import { deleteListingAction, publishListingAction } from "./actions";

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function PublishPanel({ listingId, photoCount, durationDays, unsaved = false }: { listingId: string; photoCount: number; durationDays: number; unsaved?: boolean }) {
  const [when, setWhen] = useState<"now" | "later">("now");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Any edit to the form makes the last publish message out of date (it may have been about fields since filled in).
  useEffect(() => setError(""), [unsaved]);

  const publish = () => {
    setError("");
    if (flagIncompleteForPublish()) return setError("Fill in the highlighted fields to publish.");
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
    <div className="space-y-2 border border-line bg-surface p-3">
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
          className="border border-field bg-surface p-1.5 text-sm"
        />
      )}
      {unsaved && (
        <p role="status" className="border border-l-4 border-time-warn border-l-time-warn bg-warn-soft p-2 font-bold">
          You have unsaved changes. Press Save before publishing.
        </p>
      )}
      {photoCount === 0 && !unsaved && <p className="text-xs text-muted">Add at least one photo to publish.</p>}
      {error && <p className="text-urgent">{error}</p>}
      <div id={LISTING_FORM_STATUS_ID} />
      <div className="flex gap-2">
        <button
          type="submit"
          form={LISTING_FORM_ID}
          disabled={pending || !unsaved}
          className="cursor-pointer bg-brand px-3 py-1 font-bold text-on-brand hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {unsaved ? "Save" : "Saved"}
        </button>
        <button
          onClick={publish}
          disabled={pending || photoCount === 0 || unsaved}
          className="cursor-pointer bg-brand px-3 py-1 font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "..." : "Publish"}
        </button>
        <button onClick={remove} disabled={pending} className="cursor-pointer border border-field bg-surface px-3 py-1">
          Delete draft
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { setWatchingAction } from "./watchlist-actions";

// Watch / Watching toggle on the listing page, with how many people watch it. Watched auctions are listed on /watchlist and
// the watcher gets one email about 24 hours before the auction ends.
export function WatchButton({ listingId, watching, watcherCount }: { listingId: string; watching: boolean; watcherCount: number }) {
  const [state, setState] = useState({ watching, watcherCount });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const toggle = () => {
    setError("");
    start(async () => {
      const result = await setWatchingAction(listingId, !state.watching);
      if (result.error !== undefined) setError(result.error);
      else setState({ watching: result.watching, watcherCount: result.watcherCount });
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.watching}
        className={`cursor-pointer whitespace-nowrap border px-2.5 py-1 text-sm font-bold disabled:opacity-60 ${state.watching ? "border-brand bg-surface text-brand hover:bg-head" : "border-brand bg-brand text-on-brand hover:bg-brand-dark"}`}
      >
        {state.watching ? "Remove from watchlist" : "Add to watchlist"}
      </button>
      <span className="text-xs text-muted">
        {state.watcherCount} {state.watcherCount === 1 ? "person" : "people"} interested
      </span>
      {error && <span className="text-urgent">{error}</span>}
    </span>
  );
}

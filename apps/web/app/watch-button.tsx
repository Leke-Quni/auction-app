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
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.watching}
        className={`cursor-pointer border px-3 py-1 font-bold disabled:opacity-60 ${state.watching ? "border-brand bg-brand text-white hover:bg-brand-dark" : "border-brand bg-white text-brand hover:bg-[#f0f0f0]"}`}
      >
        {state.watching ? "Watching" : "Watch"}
      </button>
      <span className="text-xs text-muted">
        {state.watcherCount} {state.watcherCount === 1 ? "watcher" : "watchers"}
      </span>
      {error && <span className="text-urgent">{error}</span>}
    </span>
  );
}

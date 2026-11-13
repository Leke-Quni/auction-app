"use client";

import { eurosToCents, formatEur, type ProxyOutcome } from "@auction/shared";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type RefObject } from "react";
import { placeBidAction } from "./bid-actions";

// A bid this many times the minimum is probably a slip of the keys, so the confirmation says so.
const FAR_ABOVE_TIMES_MINIMUM = 10;

export const toEuros = (cents: number) => (cents / 100).toFixed(2);

// What a bid that went through meant for the bidder, kept by the panel so it is still shown once the page moves them to the front.
export interface Placed {
  extended: boolean;
  endsAt?: string;
  outcome: ProxyOutcome;
  priceCents?: number;
  maxCents?: number;
}

// One form for both ways of setting a maximum: a first bid ("bid", never below the minimum next bid) and a raise by the person in
// front ("raise", which must be above their current maximum). Both are a maximum, both need a second click, and both are final.
export function BidForm({
  listingId,
  kind,
  minCents,
  startCents,
  inputRef,
  onPlaced,
}: {
  listingId: string;
  kind: "bid" | "raise";
  // The least the box accepts, and what it starts at (a raise starts one step above the current maximum, but accepts any amount above it).
  minCents: number;
  startCents: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onPlaced: (placed: Placed) => void;
}) {
  const router = useRouter();
  const raise = kind === "raise";
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(toEuros(startCents));
  const [minimum, setMinimum] = useState(minCents);
  const [error, setError] = useState("");
  // The amount (in cents) waiting for a second click to confirm, so a stray click never places a bid.
  const [confirming, setConfirming] = useState<number | null>(null);
  // One key per bid, kept while the answer is unknown, so retrying can never place the bid twice.
  const attempt = useRef<{ key: string; cents: number } | null>(null);
  const [lastStart, setLastStart] = useState(startCents);
  if (startCents !== lastStart) {
    // The listing changed (someone bid) or the maximum moved: show the new starting amount.
    setLastStart(startCents);
    setMinimum(minCents);
    setAmount(toEuros(startCents));
    setConfirming(null);
  }

  const review = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const cents = eurosToCents(amount);
    if (cents === null) return setError("Enter an amount like 25 or 25.50.");
    if (cents < minimum) return setError(raise ? `Your new maximum must be higher than ${formatEur(minimum - 1)}.` : `Your bid must be at least ${formatEur(minimum)}.`);
    setConfirming(cents);
  };

  const place = (cents: number) => {
    if (!attempt.current || attempt.current.cents !== cents) attempt.current = { key: crypto.randomUUID(), cents };
    const { key } = attempt.current;
    startTransition(async () => {
      const result = await placeBidAction(listingId, cents, key);
      if (!result.retry) attempt.current = null;
      setConfirming(null);
      if (result.ok) {
        onPlaced({ extended: Boolean(result.extended), endsAt: result.endsAt, outcome: result.outcome ?? "LEADING", priceCents: result.currentBidCents, maxCents: result.yourMaxCents });
        router.refresh();
        return;
      }
      setError(result.error ?? "That bid could not be placed.");
      if (result.minimumNextBidCents !== undefined) {
        setMinimum(result.minimumNextBidCents);
        setAmount(toEuros(result.minimumNextBidCents));
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={review} className="space-y-2 border border-line bg-surface p-3">
      <label className="block">
        <span className="text-xs text-muted">{raise ? "Raise your maximum (€)" : "Your maximum bid (€)"}</span>
        <input
          ref={inputRef}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          readOnly={confirming !== null}
          aria-describedby={`bid-help-${kind}`}
          className="mt-1 w-full border border-field bg-surface p-2 text-base font-bold"
        />
      </label>
      <p id={`bid-help-${kind}`} className="text-xs text-muted">
        {raise
          ? `It must be higher than ${formatEur(minimum - 1)}. A maximum cannot be lowered or withdrawn.`
          : `Minimum bid: ${formatEur(minimum)}. We bid for you, one step at a time, up to this amount, so you only pay what is needed to stay ahead. A maximum cannot be lowered or withdrawn.`}
      </p>
      {error && (
        <p role="alert" className="text-urgent">
          {error}
        </p>
      )}
      {confirming === null ? (
        <button type="submit" className="w-full cursor-pointer bg-brand px-3 py-2 font-bold text-on-brand hover:bg-brand-dark">
          {raise ? "Raise maximum" : "Place bid"}
        </button>
      ) : (
        <div className="space-y-2 border border-time-warn bg-warn-soft p-2">
          <p>
            {raise ? "You are about to raise your maximum to " : "You are about to bid up to "}
            <strong>{formatEur(confirming)}</strong>. You cannot lower or withdraw it.
          </p>
          {confirming >= (raise ? startCents : minimum) * FAR_ABOVE_TIMES_MINIMUM && (
            <p className="font-bold">That is far above the {raise ? "usual next step" : "minimum"} of {formatEur(raise ? startCents : minimum)}. Check the amount.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => place(confirming)}
              className="flex-1 cursor-pointer bg-brand px-3 py-2 font-bold text-on-brand hover:bg-brand-dark disabled:opacity-60"
            >
              {pending ? "Placing bid..." : raise ? `Confirm new maximum of ${formatEur(confirming)}` : `Confirm bid of ${formatEur(confirming)}`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(null)}
              className="cursor-pointer border border-field bg-surface px-3 py-2 hover:bg-head disabled:opacity-60"
            >
              Change
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

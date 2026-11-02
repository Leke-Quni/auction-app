"use client";

import { eurosToCents, formatEur } from "@auction/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { LocalTime } from "@/app/local-time";
import { placeBidAction } from "./bid-actions";

export type BidMode = "signed-out" | "owner" | "upcoming" | "ended" | "highest" | "live";

// A bid this many times the minimum is probably a slip of the keys, and bids cannot be withdrawn.
const CONFIRM_ABOVE_TIMES_MINIMUM = 10;

const toEuros = (cents: number) => (cents / 100).toFixed(2);
const note = "border border-line bg-white p-2 text-muted";

export function BidPanel({ listingId, mode, minimumNextBidCents }: { listingId: string; mode: BidMode; minimumNextBidCents: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(toEuros(minimumNextBidCents));
  const [minimum, setMinimum] = useState(minimumNextBidCents);
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState<{ extended: boolean; endsAt?: string } | null>(null);
  // One key per bid, kept while the answer is unknown, so retrying can never place the bid twice.
  const attempt = useRef<{ key: string; cents: number } | null>(null);
  const [lastMinimum, setLastMinimum] = useState(minimumNextBidCents);
  if (minimumNextBidCents !== lastMinimum) {
    // The listing changed (someone bid): show the new minimum.
    setLastMinimum(minimumNextBidCents);
    setMinimum(minimumNextBidCents);
    setAmount(toEuros(minimumNextBidCents));
  }

  if (mode === "signed-out") {
    return (
      <p className={note}>
        <Link href="/sign-in" className="text-brand underline">
          Sign in
        </Link>{" "}
        to place a bid.
      </p>
    );
  }
  if (mode === "owner") return <p className={note}>This is your listing, so you cannot bid on it.</p>;
  if (mode === "upcoming") return <p className={note}>Bidding opens when the auction starts.</p>;
  if (mode === "ended") return <p className={note}>This auction has ended.</p>;
  if (mode === "highest") {
    return (
      <div className="space-y-1">
        <p className="border border-time-ok bg-white p-2 font-bold text-time-ok">You are the highest bidder.</p>
        {placed && (
          <p className="text-muted">
            Your bid was placed.
            {placed.extended && placed.endsAt && (
              <>
                {" "}
                The auction was extended and now ends <LocalTime iso={placed.endsAt} />.
              </>
            )}
          </p>
        )}
      </div>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const cents = eurosToCents(amount);
    if (cents === null) return setError("Enter an amount like 25 or 25.50.");
    if (cents < minimum) return setError(`Your bid must be at least ${formatEur(minimum)}.`);
    if (cents >= minimum * CONFIRM_ABOVE_TIMES_MINIMUM) {
      const sure = confirm(`Bid ${formatEur(cents)}? That is far above the minimum of ${formatEur(minimum)}, and a bid cannot be withdrawn.`);
      if (!sure) return;
    }
    if (!attempt.current || attempt.current.cents !== cents) attempt.current = { key: crypto.randomUUID(), cents };
    const { key } = attempt.current;
    startTransition(async () => {
      const result = await placeBidAction(listingId, cents, key);
      if (!result.retry) attempt.current = null;
      if (result.ok) {
        setPlaced({ extended: Boolean(result.extended), endsAt: result.endsAt });
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
    <form onSubmit={submit} className="space-y-2 border border-line bg-white p-3">
      <label className="block">
        <span className="text-xs text-muted">Your bid (€)</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-describedby="bid-minimum"
          className="mt-1 w-full border border-[#888] bg-white p-2 text-base font-bold"
        />
      </label>
      <p id="bid-minimum" className="text-xs text-muted">
        Minimum bid: {formatEur(minimum)}. Bids cannot be withdrawn.
      </p>
      {error && (
        <p role="alert" className="text-urgent">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full cursor-pointer bg-brand px-3 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Placing bid..." : "Place bid"}
      </button>
    </form>
  );
}

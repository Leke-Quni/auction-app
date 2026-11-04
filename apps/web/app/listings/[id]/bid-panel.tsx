"use client";

import { eurosToCents, formatEur } from "@auction/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { LocalTime } from "@/app/local-time";
import { placeBidAction } from "./bid-actions";

export type BidMode = "signed-out" | "owner" | "blocked" | "upcoming" | "ended" | "highest" | "live";

// A bid this many times the minimum is probably a slip of the keys, so the confirmation says so.
const FAR_ABOVE_TIMES_MINIMUM = 10;

const toEuros = (cents: number) => (cents / 100).toFixed(2);
const note = "border border-line bg-white p-2 text-muted";

// The sale this auction ended in, for the winner and the seller, who are pointed to the order.
export interface BidPanelOrder {
  id: string;
  viewer: "buyer" | "seller";
  status: string;
  amountCents: number;
}

export function BidPanel({ listingId, mode, minimumNextBidCents, order }: { listingId: string; mode: BidMode; minimumNextBidCents: number; order?: BidPanelOrder }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(toEuros(minimumNextBidCents));
  const [minimum, setMinimum] = useState(minimumNextBidCents);
  const [error, setError] = useState("");
  // The amount (in cents) waiting for a second click to confirm, so a stray click never places a bid.
  const [confirming, setConfirming] = useState<number | null>(null);
  const [placed, setPlaced] = useState<{ extended: boolean; endsAt?: string } | null>(null);
  // One key per bid, kept while the answer is unknown, so retrying can never place the bid twice.
  const attempt = useRef<{ key: string; cents: number } | null>(null);
  const [lastMinimum, setLastMinimum] = useState(minimumNextBidCents);
  if (minimumNextBidCents !== lastMinimum) {
    // The listing changed (someone bid): show the new minimum.
    setLastMinimum(minimumNextBidCents);
    setMinimum(minimumNextBidCents);
    setAmount(toEuros(minimumNextBidCents));
    setConfirming(null);
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
  if (mode === "blocked") return <p className={note}>You cannot bid because you did not pay for auctions you won (two strikes).</p>;
  if (mode === "upcoming") return <p className={note}>Bidding opens when the auction starts.</p>;
  if (mode === "ended" && order) {
    const lapsed = order.status === "EXPIRED" || order.status === "CANCELLED";
    const toPay = order.viewer === "buyer" && order.status === "AWAITING_PAYMENT";
    return (
      <p className="border border-brand bg-white p-2">
        This auction has ended.{" "}
        {lapsed
          ? order.viewer === "buyer"
            ? "You did not pay for it in time, so the order was cancelled. "
            : "The buyer did not pay, so it ended without a sale. "
          : order.viewer === "buyer"
            ? toPay
              ? `You won it for ${formatEur(order.amountCents)}. `
              : "You won it. "
            : "This item sold. "}
        <Link href={`/orders/${order.id}`} className="text-brand underline">
          {toPay ? "Pay now" : "View the order"}
        </Link>
      </p>
    );
  }
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

  const review = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const cents = eurosToCents(amount);
    if (cents === null) return setError("Enter an amount like 25 or 25.50.");
    if (cents < minimum) return setError(`Your bid must be at least ${formatEur(minimum)}.`);
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
    <form onSubmit={review} className="space-y-2 border border-line bg-white p-3">
      <label className="block">
        <span className="text-xs text-muted">Your bid (€)</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          readOnly={confirming !== null}
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
      {confirming === null ? (
        <button type="submit" className="w-full cursor-pointer bg-brand px-3 py-2 font-bold text-white hover:bg-brand-dark">
          Place bid
        </button>
      ) : (
        <div className="space-y-2 border border-time-warn bg-[#fff7e6] p-2">
          <p>
            You are about to bid <strong>{formatEur(confirming)}</strong>. A bid cannot be withdrawn.
          </p>
          {confirming >= minimum * FAR_ABOVE_TIMES_MINIMUM && (
            <p className="font-bold">That is far above the minimum of {formatEur(minimum)}. Check the amount.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => place(confirming)}
              className="flex-1 cursor-pointer bg-brand px-3 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {pending ? "Placing bid..." : `Confirm bid of ${formatEur(confirming)}`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(null)}
              className="cursor-pointer border border-[#888] bg-white px-3 py-2 hover:bg-[#f0f0f0] disabled:opacity-60"
            >
              Change
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

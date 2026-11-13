"use client";

import { formatEur, minimumNextBidCents as minimumFor } from "@auction/shared";
import Link from "next/link";
import { useRef, useState } from "react";
import { LocalTime } from "@/app/local-time";
import { BidForm, type Placed } from "./bid-form";

export type BidMode = "signed-out" | "owner" | "blocked" | "upcoming" | "ended" | "highest" | "live";

const note = "border border-line bg-surface p-2 text-muted";

// The sale this auction ended in, for the winner and the seller, who are pointed to the order.
export interface BidPanelOrder {
  id: string;
  viewer: "buyer" | "seller";
  status: string;
  amountCents: number;
}

// What the bid just placed meant for the bidder: in front at the price, beaten at once by a higher maximum, or a raised maximum.
function PlacedNote({ placed, onRaise }: { placed: Placed; onRaise: () => void }) {
  const price = placed.priceCents === undefined ? "" : ` at ${formatEur(placed.priceCents)}`;
  return (
    <div className="space-y-1 text-muted">
      {placed.outcome === "OUTBID_BY_PROXY" ? (
        <>
          <p>
            Someone has a higher maximum. The price is now {placed.priceCents === undefined ? "higher" : formatEur(placed.priceCents)}.
          </p>
          <button type="button" onClick={onRaise} className="cursor-pointer border border-field bg-surface px-3 py-1 hover:bg-head">
            Raise your maximum
          </button>
        </>
      ) : placed.outcome === "MAX_RAISED" ? (
        <p>Your maximum is now {placed.maxCents === undefined ? "raised" : formatEur(placed.maxCents)}.</p>
      ) : (
        <p>You are the highest bidder{price}.</p>
      )}
      {placed.extended && placed.endsAt && (
        <p>
          The auction was extended and now ends <LocalTime iso={placed.endsAt} />.
        </p>
      )}
    </div>
  );
}

export function BidPanel({
  listingId,
  mode,
  minimumNextBidCents,
  viewerMaxCents,
  onMaxChange,
  order,
}: {
  listingId: string;
  mode: BidMode;
  minimumNextBidCents: number;
  // The viewer's own hidden maximum, when the API sent it, and a way to tell the page when a bid changes it.
  viewerMaxCents?: number | null;
  onMaxChange?: (cents: number) => void;
  order?: BidPanelOrder;
}) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const amountBox = useRef<HTMLInputElement>(null);
  const focusBox = () => amountBox.current?.focus();
  const onPlaced = (result: Placed) => {
    setPlaced(result);
    if (result.maxCents !== undefined) onMaxChange?.(result.maxCents);
  };
  // A maximum only rises, so the higher of what the page knows and what the last bid said is the current one.
  const myMax = viewerMaxCents == null && placed?.maxCents === undefined ? null : Math.max(viewerMaxCents ?? 0, placed?.maxCents ?? 0);

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
  if (mode === "blocked") {
    return (
      <p className={note}>
        You cannot bid because your account has two strikes (for example, from not paying for auctions you won).{" "}
        <Link href="/support?appeal" className="text-brand underline">
          Appeal a strike
        </Link>
      </p>
    );
  }
  if (mode === "upcoming") return <p className={note}>Bidding opens when the auction starts.</p>;
  if (mode === "ended" && order) {
    const lapsed = order.status === "EXPIRED" || order.status === "CANCELLED";
    const toPay = order.viewer === "buyer" && order.status === "AWAITING_PAYMENT";
    return (
      <p className="border border-brand bg-surface p-2">
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
      <div className="space-y-2">
        <div className="space-y-1">
          <p className="border border-time-ok bg-surface p-2 font-bold text-time-ok">You are the highest bidder.</p>
          {myMax !== null && <p className="text-muted">Your maximum: {formatEur(myMax)}</p>}
        </div>
        {placed && <PlacedNote placed={placed} onRaise={focusBox} />}
        {myMax !== null && (
          <BidForm
            listingId={listingId}
            kind="raise"
            minCents={myMax + 1}
            startCents={minimumFor({ startingPriceCents: 0, currentBidCents: myMax })}
            inputRef={amountBox}
            onPlaced={onPlaced}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <BidForm listingId={listingId} kind="bid" minCents={minimumNextBidCents} startCents={minimumNextBidCents} inputRef={amountBox} onPlaced={onPlaced} />
      {placed && <PlacedNote placed={placed} onRaise={focusBox} />}
    </div>
  );
}

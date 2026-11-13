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

// What the bid just placed meant for the bidder: in front at the price or a raised maximum. Being beaten at once is told by the box above the
// bid form, which stays for as long as the bidder is behind; this adds only that the bid extended the auction.
// A note that states a price is dropped once the price has gone above it (prices only rise, so until then, including the moment before
// the page has caught up with the bid, it still holds). A raised maximum states no price, so it holds for as long as the bidder is in front.
// It is a status, so a screen reader announces it when it appears.
function PlacedNote({ placed, currentBidCents, leading }: { placed: Placed; currentBidCents?: number | null; leading: boolean }) {
  const stale =
    placed.outcome === "MAX_RAISED"
      ? !leading
      : placed.priceCents !== undefined && currentBidCents != null && currentBidCents > placed.priceCents;
  if (stale || (placed.outcome === "OUTBID_BY_PROXY" && !(placed.extended && placed.endsAt))) return null;
  const price = placed.priceCents === undefined ? "" : ` at ${formatEur(placed.priceCents)}`;
  return (
    <div role="status" className="space-y-1 text-muted">
      {placed.outcome === "OUTBID_BY_PROXY" ? null : placed.outcome === "MAX_RAISED" ? (
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
  currentBidCents,
  viewerMaxCents,
  onMaxChange,
  order,
}: {
  listingId: string;
  mode: BidMode;
  minimumNextBidCents: number;
  // The price now, so a result note that quotes an older price can go.
  currentBidCents?: number | null;
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
        {placed && <PlacedNote placed={placed} currentBidCents={currentBidCents} leading />}
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

  // Someone with a maximum on this listing who is not in front has been beaten, whether by an earlier proxy answer or by a later bid.
  // Right after a bid that put them in front, the page has not caught up yet, so that bid's own answer says they lead.
  const passedPrice = placed?.priceCents !== undefined && currentBidCents != null && currentBidCents > placed.priceCents;
  const justLed = placed !== null && placed.outcome !== "OUTBID_BY_PROXY" && !passedPrice;
  const beaten = myMax !== null && !justLed;
  const price = currentBidCents ?? placed?.priceCents;

  return (
    <div className="space-y-2">
      {beaten && (
        <div role="status" className="space-y-1 border border-urgent bg-surface p-2">
          <p className="font-bold text-urgent">You are not the highest bidder.</p>
          <p className="text-muted">
            Your maximum of {formatEur(myMax)} has been beaten{price != null && <> and the price is now {formatEur(price)}</>}. Raise your maximum to get back in front.
          </p>
          <button type="button" onClick={focusBox} className="cursor-pointer border border-field bg-surface px-3 py-1 hover:bg-head">
            Raise your maximum
          </button>
        </div>
      )}
      <BidForm listingId={listingId} kind="bid" minCents={minimumNextBidCents} startCents={minimumNextBidCents} inputRef={amountBox} onPlaced={onPlaced} />
      {placed && <PlacedNote placed={placed} currentBidCents={currentBidCents} leading={false} />}
    </div>
  );
}

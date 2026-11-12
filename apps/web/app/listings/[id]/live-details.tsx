"use client";

import { CONDITION_LABELS, formatDuration, formatEur, displayUsername } from "@auction/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Countdown } from "@/app/countdown";
import { LocalTime } from "@/app/local-time";
import { BidHistory } from "./bid-history";
import { BidPanel, type BidMode, type BidPanelOrder } from "./bid-panel";
import { useLive } from "./live-auction";

const PHASE_LABELS = { draft: "Draft", upcoming: "Upcoming", live: "Live", ended: "Ended" } as const;

export interface DetailsListing {
  id: string;
  phase: keyof typeof PHASE_LABELS;
  condition: keyof typeof CONDITION_LABELS;
  category: { name: string };
  seller: { username: string };
  startingPriceCents: number;
  reservePriceCents: number | null;
  durationDays: number;
  startsAt: string | null;
  // Set once the auction has been closed, a moment after it ends.
  outcome: "SOLD" | "NO_SALE" | "NO_BIDS" | null;
  // True when a moderator ended the auction early: whatever the bids, nobody won.
  removed?: boolean;
  winner: { id: string; username: string } | null;
  finalPriceCents: number | null;
}

const RESULT_CHECK_MS = 10_000;
// About five minutes of asking; a close that is still not saved by then will not be fixed by more requests.
const RESULT_CHECK_LIMIT = 30;

function resultText(listing: DetailsListing, viewerId?: string, topBidCents?: number | null): string {
  if (listing.removed && listing.outcome) return "Ended by a moderator: no sale";
  if (listing.outcome === "SOLD" && listing.winner && listing.finalPriceCents != null) {
    return `Sold for ${formatEur(listing.finalPriceCents)} to ${listing.winner.id === viewerId ? `${displayUsername(listing.winner.username)} (you)` : displayUsername(listing.winner.username)}`;
  }
  if (listing.outcome === "NO_SALE") {
    // Either the top bid never reached the reserve, or the buyers it was offered to did not pay.
    const reserveMissed = listing.reservePriceCents != null && (topBidCents ?? 0) < listing.reservePriceCents;
    return reserveMissed ? "Not sold: the reserve price was not met" : "Not sold: no buyer paid";
  }
  if (listing.outcome === "NO_BIDS") return "Not sold: there were no bids";
  return "Closing the auction...";
}

// setTimeout cannot wait longer than this (about 24.8 days); a longer wait is split into several.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// The auction's phase as time passes, measured on the server's clock, so an upcoming page goes live and a live page
// ends without a reload. The page is refreshed when the auction starts to pick up its state.
function usePhase(initial: DetailsListing["phase"], startsAt: string | null, endsAt: string | null, serverTime: string) {
  const router = useRouter();
  const [phase, setPhase] = useState(initial);
  const phaseRef = useRef(initial);
  useEffect(() => {
    if (initial === "draft" || initial === "ended" || !startsAt || !endsAt) return;
    const offset = Date.parse(serverTime) - Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const now = Date.now() + offset;
      const starts = Date.parse(startsAt);
      const ends = Date.parse(endsAt);
      const next = now >= ends ? "ended" : now >= starts ? "live" : "upcoming";
      const previous = phaseRef.current;
      phaseRef.current = next;
      setPhase(next);
      if (previous === "upcoming" && next === "live") router.refresh();
      if (next !== "ended") timer = setTimeout(check, Math.min((next === "live" ? ends : starts) - now + 50, MAX_TIMEOUT_MS));
    };
    check();
    return () => clearTimeout(timer);
  }, [initial, startsAt, endsAt, serverTime, router]);
  return initial === "ended" ? "ended" : phase;
}

export function LiveDetails({ listing, openMode, viewerId, order }: { listing: DetailsListing; openMode: BidMode | null; viewerId?: string; order?: BidPanelOrder }) {
  // Not `bids`: the history is shown by LiveHistory, so a change to it alone does not need this table drawn again.
  const live = useLive(
    useShallow((s) => ({
      currentBidCents: s.currentBidCents,
      bidCount: s.bidCount,
      highBidder: s.highBidder,
      minimumNextBidCents: s.minimumNextBidCents,
      endsAt: s.endsAt,
      extensionCount: s.extensionCount,
      serverTime: s.serverTime,
    })),
  );
  const phase = usePhase(listing.phase, listing.startsAt, live.endsAt, live.serverTime);
  const isLive = phase === "live";
  // The result is saved a moment after the end, so ask for the page again until it is there.
  const router = useRouter();
  const awaitingResult = phase === "ended" && listing.outcome === null;
  useEffect(() => {
    if (!awaitingResult) return;
    let checks = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++checks >= RESULT_CHECK_LIMIT) clearInterval(timer);
    }, RESULT_CHECK_MS);
    return () => clearInterval(timer);
  }, [awaitingResult, router]);
  // Being the high bidder changes as bids arrive; the rest is settled by the server and the clock.
  const bidMode: BidMode | null =
    openMode === null || phase === "draft"
      ? null
      : phase === "ended"
        ? "ended"
        : phase === "upcoming"
          ? "upcoming"
          : openMode === "live" || openMode === "highest"
            ? live.highBidder?.id === viewerId
              ? "highest"
              : "live"
            : openMode;
  const reserveNote =
    listing.reservePriceCents == null || live.bidCount === 0 || live.currentBidCents == null
      ? ""
      : live.currentBidCents >= listing.reservePriceCents
        ? " (met)"
        : " (not met)";

  const rows: [string, React.ReactNode][] = [
    [
      live.bidCount > 0 ? "Current bid" : "Starting price",
      <span key="p" className="font-bold">
        {formatEur(live.currentBidCents ?? listing.startingPriceCents)}
      </span>,
    ],
    ...(live.bidCount > 0 ? ([["Starting price", formatEur(listing.startingPriceCents)]] as [string, React.ReactNode][]) : []),
    ["Bids", String(live.bidCount)],
    ...(live.highBidder
      ? ([["High bidder", live.highBidder.id === viewerId ? `${displayUsername(live.highBidder.username)} (you)` : displayUsername(live.highBidder.username)]] as [string, React.ReactNode][])
      : []),
    ...(isLive ? ([["Minimum next bid", formatEur(live.minimumNextBidCents)]] as [string, React.ReactNode][]) : []),
    ["Reserve price", listing.reservePriceCents == null ? "None" : `${formatEur(listing.reservePriceCents)}${reserveNote}`],
    ["Condition", CONDITION_LABELS[listing.condition]],
    ["Category", listing.category.name],
    ["Duration", formatDuration(listing.durationDays)],
    ...(listing.startsAt ? ([["Starts", <LocalTime key="s" iso={listing.startsAt} />]] as [string, React.ReactNode][]) : []),
    ...(live.endsAt
      ? ([
          isLive && listing.startsAt
            ? ["Time left", <Countdown key="e" iso={live.endsAt} startIso={listing.startsAt} serverNowIso={live.serverTime} />]
            : ["Ends", <LocalTime key="e" iso={live.endsAt} />],
        ] as [string, React.ReactNode][])
      : []),
    ["Status", PHASE_LABELS[phase]],
    ...(phase === "ended" ? ([["Result", <span key="r" className="font-bold">{resultText(listing, viewerId, live.currentBidCents)}</span>]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <>
      {isLive && live.extensionCount > 0 && live.endsAt && (
        <p role="status" className="border border-l-4 border-time-warn border-l-time-warn bg-warn-soft p-2 font-bold">
          The auction was extended by a late bid. It now ends at <LocalTime iso={live.endsAt} timeFirst />.
        </p>
      )}
      <table className="w-full border-collapse bg-surface">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th className="w-36 border border-line bg-head p-1.5 text-left font-normal text-muted">{label}</th>
              <td className="border border-line p-1.5">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bidMode && <BidPanel listingId={listing.id} mode={bidMode} minimumNextBidCents={live.minimumNextBidCents} order={order} />}
    </>
  );
}

export function LiveHistory({ viewerId }: { viewerId?: string }) {
  const bids = useLive((s) => s.bids);
  const total = useLive((s) => s.bidCount);
  return <BidHistory bids={bids} total={total} viewerId={viewerId} />;
}

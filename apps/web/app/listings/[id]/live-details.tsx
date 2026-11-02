"use client";

import { CONDITION_LABELS, formatDuration, formatEur } from "@auction/shared";
import { Countdown } from "@/app/countdown";
import { LocalTime } from "@/app/local-time";
import { BidHistory } from "./bid-history";
import { BidPanel, type BidMode } from "./bid-panel";
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
}

export function LiveDetails({ listing, mode, viewerId }: { listing: DetailsListing; mode: BidMode | null; viewerId?: string }) {
  const live = useLive((s) => s);
  const isLive = listing.phase === "live";
  // Being the high bidder changes as bids arrive; every other mode is settled by the server.
  const bidMode: BidMode | null = mode === "live" || mode === "highest" ? (live.highBidder?.id === viewerId ? "highest" : "live") : mode;
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
      ? ([["High bidder", live.highBidder.id === viewerId ? `${live.highBidder.username} (you)` : live.highBidder.username]] as [string, React.ReactNode][])
      : []),
    ...(isLive ? ([["Minimum next bid", formatEur(live.minimumNextBidCents)]] as [string, React.ReactNode][]) : []),
    ["Reserve price", listing.reservePriceCents == null ? "None" : `${formatEur(listing.reservePriceCents)}${reserveNote}`],
    ["Condition", CONDITION_LABELS[listing.condition]],
    ["Category", listing.category.name],
    ["Seller", listing.seller.username],
    ["Duration", formatDuration(listing.durationDays)],
    ...(listing.startsAt ? ([["Starts", <LocalTime key="s" iso={listing.startsAt} />]] as [string, React.ReactNode][]) : []),
    ...(live.endsAt
      ? ([
          isLive && listing.startsAt
            ? ["Time left", <Countdown key="e" iso={live.endsAt} startIso={listing.startsAt} serverNowIso={live.serverTime} />]
            : ["Ends", <LocalTime key="e" iso={live.endsAt} />],
        ] as [string, React.ReactNode][])
      : []),
    ["Status", PHASE_LABELS[listing.phase]],
  ];

  return (
    <>
      {isLive && live.extensionCount > 0 && live.endsAt && (
        <p role="status" className="border border-l-4 border-time-warn border-l-time-warn bg-[#fff7e6] p-2 font-bold">
          The auction was extended by a late bid. It now ends at <LocalTime iso={live.endsAt} timeFirst />.
        </p>
      )}
      <table className="w-full border-collapse bg-white">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th className="w-36 border border-line bg-[#f0f0f0] p-1.5 text-left font-normal text-muted">{label}</th>
              <td className="border border-line p-1.5">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bidMode && <BidPanel listingId={listing.id} mode={bidMode} minimumNextBidCents={live.minimumNextBidCents} />}
    </>
  );
}

export function LiveHistory({ viewerId }: { viewerId?: string }) {
  const bids = useLive((s) => s.bids);
  const total = useLive((s) => s.bidCount);
  return <BidHistory bids={bids} total={total} viewerId={viewerId} />;
}

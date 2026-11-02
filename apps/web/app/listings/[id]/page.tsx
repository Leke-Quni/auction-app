import { CONDITION_LABELS, formatDuration, formatEur, isFinalChance } from "@auction/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Countdown } from "@/app/countdown";
import { Gallery } from "@/app/gallery";
import { LocalTime } from "@/app/local-time";
import { auth } from "@/auth";
import { apiFetch, authedApiFetch } from "@/lib/api";
import { BidHistory, type BidRow } from "./bid-history";
import { BidPanel, type BidMode } from "./bid-panel";

const PHASE_LABELS = { draft: "Draft", upcoming: "Upcoming", live: "Live", ended: "Ended" } as const;

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const res = session ? await authedApiFetch(`/listings/${id}`) : await apiFetch(`/listings/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /listings/${id} failed: ${res.status}`);
  const listing = await res.json();
  const isOwner = session?.user.id === listing.seller.id;
  const viewerId = session?.user.id;

  const published = listing.status === "PUBLISHED";
  const historyRes = published ? await apiFetch(`/listings/${id}/bids?limit=20`) : null;
  const history: { items: BidRow[]; total: number } = historyRes?.ok ? await historyRes.json() : { items: [], total: 0 };

  const live = listing.phase === "live";
  const mode: BidMode | null = !published
    ? null
    : listing.phase === "ended"
      ? "ended"
      : listing.phase === "upcoming"
        ? "upcoming"
        : !session
          ? "signed-out"
          : isOwner
            ? "owner"
            : listing.highBidder?.id === viewerId
              ? "highest"
              : "live";
  const reserveNote =
    listing.reservePriceCents == null || listing.bidCount === 0
      ? ""
      : listing.currentBidCents >= listing.reservePriceCents
        ? " (met)"
        : " (not met)";

  const rows: [string, React.ReactNode][] = [
    [
      listing.bidCount > 0 ? "Current bid" : "Starting price",
      <span key="p" className="font-bold">
        {formatEur(listing.currentBidCents ?? listing.startingPriceCents)}
      </span>,
    ],
    ...(listing.bidCount > 0 ? ([["Starting price", formatEur(listing.startingPriceCents)]] as [string, React.ReactNode][]) : []),
    ["Bids", String(listing.bidCount)],
    ...(listing.highBidder
      ? ([["High bidder", listing.highBidder.id === viewerId ? `${listing.highBidder.username} (you)` : listing.highBidder.username]] as [string, React.ReactNode][])
      : []),
    ...(live ? ([["Minimum next bid", formatEur(listing.minimumNextBidCents)]] as [string, React.ReactNode][]) : []),
    ["Reserve price", listing.reservePriceCents == null ? "None" : `${formatEur(listing.reservePriceCents)}${reserveNote}`],
    ["Condition", CONDITION_LABELS[listing.condition as keyof typeof CONDITION_LABELS]],
    ["Category", listing.category.name],
    ["Seller", listing.seller.username],
    ["Duration", formatDuration(listing.durationDays)],
    ...(listing.startsAt ? ([["Starts", <LocalTime key="s" iso={listing.startsAt} />]] as [string, React.ReactNode][]) : []),
    ...(listing.endsAt
      ? ([
          live && listing.startsAt
            ? ["Time left", <Countdown key="e" iso={listing.endsAt} startIso={listing.startsAt} serverNowIso={listing.serverTime} />]
            : ["Ends", <LocalTime key="e" iso={listing.endsAt} />],
        ] as [string, React.ReactNode][])
      : []),
    ["Status", PHASE_LABELS[listing.phase as keyof typeof PHASE_LABELS]],
  ];

  return (
    <div className="space-y-3">
      {isOwner && (
        <p className="border border-brand bg-white p-2">
          {listing.status === "DRAFT" ? "This is a draft. Only you can see it. " : "This is your listing. "}
          <Link href={`/sell/${listing.id}/edit`} className="text-brand underline">
            {listing.status === "DRAFT" ? "Edit and publish" : "Edit description and photos"}
          </Link>
        </p>
      )}
      <h1 className="border border-line bg-white p-2 text-lg font-bold">{listing.title}</h1>
      {/* items-start: the photo is a square, and stretching it to the taller details column would widen its column. */}
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_2fr]">
        <div className="min-w-0">
          <Gallery images={listing.images} alt={listing.title} />
        </div>
        <div className="min-w-0 space-y-3">
          {live && isFinalChance(listing.extensionCount) && (
            <p role="status" className="border border-urgent bg-white p-2 font-bold text-urgent">
              Final chance to bid. This auction cannot be extended again.
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
          {mode && <BidPanel listingId={listing.id} mode={mode} minimumNextBidCents={listing.minimumNextBidCents} />}
        </div>
      </div>
      {published && <BidHistory bids={history.items} total={history.total} viewerId={viewerId} />}
      <div className="border border-line bg-white p-3">
        <h2 className="mb-1 text-sm font-bold">Description</h2>
        <p className="whitespace-pre-wrap">{listing.description}</p>
      </div>
    </div>
  );
}

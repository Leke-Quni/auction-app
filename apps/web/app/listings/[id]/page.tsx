import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/app/gallery";
import { auth } from "@/auth";
import { apiFetch, authedApiFetch } from "@/lib/api";
import type { BidRow } from "./bid-history";
import type { BidMode } from "./bid-panel";
import { LiveAuction, type LiveSnapshot } from "./live-auction";
import { LiveDetails, LiveHistory } from "./live-details";

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

  // What the viewer sees once the auction is open. The page works out upcoming, live and ended itself as time passes.
  const openMode: BidMode | null = !published
    ? null
    : !session
      ? "signed-out"
      : isOwner
        ? "owner"
        : listing.highBidder?.id === viewerId
          ? "highest"
          : "live";
  const snapshot: LiveSnapshot = {
    currentBidCents: listing.currentBidCents ?? null,
    bidCount: listing.bidCount,
    highBidder: listing.highBidder ?? null,
    minimumNextBidCents: listing.minimumNextBidCents,
    endsAt: listing.endsAt ?? null,
    extensionCount: listing.extensionCount,
    serverTime: listing.serverTime,
    bids: history.items,
  };

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
      <LiveAuction listingId={listing.id} snapshot={snapshot} connect={published && listing.phase !== "ended"}>
        {/* items-start: the photo is a square, and stretching it to the taller details column would widen its column. */}
        <div className="grid items-start gap-3 sm:grid-cols-[1fr_2fr]">
          <div className="min-w-0">
            <Gallery images={listing.images} alt={listing.title} />
          </div>
          <div className="min-w-0 space-y-3">
            <LiveDetails listing={listing} openMode={openMode} viewerId={viewerId} />
          </div>
        </div>
        {published && <LiveHistory viewerId={viewerId} />}
      </LiveAuction>
      <div className="border border-line bg-white p-3">
        <h2 className="mb-1 text-sm font-bold">Description</h2>
        <p className="whitespace-pre-wrap">{listing.description}</p>
      </div>
    </div>
  );
}

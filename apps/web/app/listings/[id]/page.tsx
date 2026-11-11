import Link from "next/link";
import { BID_HISTORY_SHOWN, POLICY_LINKS, type OrderView, type QuestionItem } from "@auction/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "@/app/gallery";
import { auth } from "@/auth";
import { apiFetch, authedApiFetch } from "@/lib/api";
import type { BidRow } from "./bid-history";
import type { BidMode } from "./bid-panel";
import { LiveAuction, type LiveSnapshot } from "./live-auction";
import { LiveDetails, LiveHistory, type DetailsListing } from "./live-details";
import { Questions } from "./questions";
import { RelistButton } from "./relist-button";
import { SellerInfo } from "../../seller-info";
import { WatchButton } from "../../watch-button";

// The tab's title is the listing's own. The listing is asked for the same way as in the page below, so the two share one request.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const session = await auth();
  const res = await (session ? authedApiFetch : apiFetch)(`/listings/${id}`).catch(() => null);
  const title = res?.ok ? (await res.json()).title : null;
  return { title: title ? `${title} - Auctionly` : "Auctionly" };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  // The listing, its latest bids and its questions are asked for together. A draft or a missing listing has no bids or questions,
  // and those two answers are then ignored.
  const [res, historyRes, questionsRes] = await Promise.all([
    session ? authedApiFetch(`/listings/${id}`) : apiFetch(`/listings/${id}`),
    apiFetch(`/listings/${id}/bids?limit=${BID_HISTORY_SHOWN}`),
    (session ? authedApiFetch : apiFetch)(`/listings/${id}/questions`),
  ]);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /listings/${id} failed: ${res.status}`);
  const listing = await res.json();
  const isOwner = session?.user.id === listing.seller.id;
  const viewerId = session?.user.id;

  const published = listing.status === "PUBLISHED";
  const history: { items: BidRow[]; total: number } = published && historyRes.ok ? await historyRes.json() : { items: [], total: 0 };
  const questions: { items: QuestionItem[]; total: number } = published && questionsRes.ok ? await questionsRes.json() : { items: [], total: 0 };
  // The winner and the seller of a sale are pointed to its order. This needs the listing's result, so it comes second.
  const ordersRes = session && (listing.outcome === "SOLD" || listing.outcome === "NO_SALE") ? await authedApiFetch(`/orders?listingId=${id}`) : null;
  const order: OrderView | undefined = ordersRes?.ok ? (await ordersRes.json())[0] : undefined;

  // What the viewer sees once the auction is open. The page works out upcoming, live and ended itself as time passes.
  const openMode: BidMode | null = !published
    ? null
    : !session
      ? "signed-out"
      : isOwner
        ? "owner"
        : listing.viewerBlocked
          ? "blocked"
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

  // Only what the live table shows is sent to the browser, not the whole listing.
  const details: DetailsListing = {
    id: listing.id,
    phase: listing.phase,
    condition: listing.condition,
    category: { name: listing.category.name },
    seller: { username: listing.seller.username },
    startingPriceCents: listing.startingPriceCents,
    reservePriceCents: listing.reservePriceCents,
    durationDays: listing.durationDays,
    startsAt: listing.startsAt,
    outcome: listing.outcome,
    removed: listing.removed,
    winner: listing.winner,
    finalPriceCents: listing.finalPriceCents,
  };

  return (
    <div className="space-y-3">
      {isOwner && (
        <p className="border border-brand bg-surface p-2">
          {listing.status === "DRAFT" ? "This is a draft. Only you can see it. " : "This is your listing. "}
          {!listing.removed && listing.phase !== "ended" && (
            <Link href={`/sell/${listing.id}/edit`} className="text-brand underline">
              {listing.status === "DRAFT" ? "Edit and publish" : listing.bidCount > 0 ? "Edit pickup address" : "Edit description and photos"}
            </Link>
          )}
          {listing.closedAt && !listing.removed && (listing.outcome === "NO_SALE" || listing.outcome === "NO_BIDS") && (
            <>
              {" "}
              <RelistButton listingId={listing.id} />
            </>
          )}
        </p>
      )}
      {listing.removed && (
        <p className="border border-red-300 bg-red-50 p-2 text-red-900">
          {isOwner ? "A moderator removed this listing and ended the auction with no sale." : "This listing was removed by moderation and the auction ended with no sale."}
          {isOwner && listing.removalReason ? ` Reason: ${listing.removalReason}` : ""}{" "}
          <Link href={POLICY_LINKS.listings} className="underline">
            See what you can and cannot list, and which photos are allowed
          </Link>
          .
        </p>
      )}
      <h1 className="border border-line bg-surface p-2 text-lg font-bold">{listing.title}</h1>
      <LiveAuction listingId={listing.id} snapshot={snapshot} connect={published && listing.phase !== "ended"}>
        {/* items-start: the photo is a square, and stretching it to the taller details column would widen its column. */}
        <div className="grid items-start gap-3 sm:grid-cols-[1fr_2fr]">
          <div className="min-w-0">
            <Gallery images={listing.images} alt={listing.title} />
            {published && (
              <div className="mt-2">
                {session && !isOwner && (listing.phase !== "ended" || listing.watching) ? (
                  <WatchButton key={`${listing.watching}-${listing.watcherCount}`} listingId={listing.id} watching={!!listing.watching} watcherCount={listing.watcherCount ?? 0} />
                ) : (
                  <span className="text-xs text-muted">
                    {listing.watcherCount ?? 0} {listing.watcherCount === 1 ? "person" : "people"} interested
                  </span>
                )}
              </div>
            )}
            <SellerInfo username={listing.seller.username} average={listing.sellerRating?.average ?? null} count={listing.sellerRating?.count ?? 0} isOwner={isOwner} />
          </div>
          <div className="min-w-0 space-y-3">
            <LiveDetails listing={details} openMode={openMode} viewerId={viewerId} order={order} />
          </div>
        </div>
        {published && <LiveHistory viewerId={viewerId} />}
      </LiveAuction>
      <div className="border border-line bg-surface p-3">
        <h2 className="mb-1 text-sm font-bold">Description</h2>
        {listing.removed && !isOwner ? (
          <p className="italic text-muted">
            This listing was removed by moderation.{" "}
            <Link href={POLICY_LINKS.listings} className="text-brand underline">
              See what you can and cannot list
            </Link>
            .
          </p>
        ) : (
          <p className="whitespace-pre-wrap">{listing.description}</p>
        )}
      </div>
      {published && (
        <Questions
          listingId={listing.id}
          items={questions.items}
          total={questions.total}
          viewerId={viewerId}
          isSeller={isOwner}
          open={listing.phase !== "ended"}
        />
      )}
    </div>
  );
}

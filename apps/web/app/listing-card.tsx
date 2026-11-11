import { formatEur } from "@auction/shared";
import Link from "next/link";
import { Countdown } from "./countdown";
import { LocalTime } from "./local-time";

export interface ListingSummary {
  id: string;
  title: string;
  startingPriceCents: number;
  phase: "draft" | "upcoming" | "live" | "ended";
  startsAt: string | null;
  endsAt: string | null;
  images: { id: string; url: string }[];
  finalChance?: boolean;
  currentBidCents?: number | null;
  bidCount?: number;
}

export function ListingCard({ listing }: { listing: ListingSummary }) {
  const cover = listing.images[0];
  return (
    <Link href={`/listings/${listing.id}`} className="flex h-full flex-col overflow-hidden border border-line bg-surface transition-shadow hover:border-brand hover:shadow-md motion-reduce:transition-none">
      <div className="relative">
        {cover ? (
          <img src={cover.url} alt="" className="aspect-square w-full bg-sunken object-cover" loading="lazy" />
        ) : (
          <div className="flex aspect-square items-center justify-center bg-sunken text-muted">No photo</div>
        )}
        {listing.phase === "live" && listing.finalChance && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-flag/80 px-2 py-0.5 text-xs font-bold text-on-flag backdrop-blur-[2px]">Final chance to bid</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <p className="line-clamp-2 font-bold">{listing.title}</p>
        <p>
          <span className="text-base font-bold">{formatEur(listing.currentBidCents ?? listing.startingPriceCents)}</span>{" "}
          <span className="text-xs text-muted">{listing.currentBidCents != null ? "current bid" : "starting"}</span>
        </p>
        {(listing.bidCount ?? 0) > 0 && (
          <p className="text-sm font-bold text-brand">
            {listing.bidCount} {listing.bidCount === 1 ? "bid" : "bids"}
          </p>
        )}
        {/* The time sits at the bottom of the card, so it lines up across a row whatever the title and price take. */}
        {listing.phase === "upcoming" && listing.startsAt ? (
          <p className="mt-auto text-xs text-muted">
            Starts <LocalTime iso={listing.startsAt} />
          </p>
        ) : (
          listing.endsAt &&
          (listing.phase === "live" && listing.startsAt ? (
            <p className="mt-auto text-xs">
              <Countdown iso={listing.endsAt} startIso={listing.startsAt} />
            </p>
          ) : (
            <p className="mt-auto text-xs text-muted">
              Ends <LocalTime iso={listing.endsAt} />
            </p>
          ))
        )}
      </div>
    </Link>
  );
}

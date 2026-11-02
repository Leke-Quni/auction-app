import { formatEur, isFinalChance } from "@auction/shared";
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
  extensionCount?: number;
}

export function ListingCard({ listing }: { listing: ListingSummary }) {
  const cover = listing.images[0];
  return (
    <Link href={`/listings/${listing.id}`} className="block border border-line bg-white hover:border-brand">
      <div className="relative">
        {cover ? (
          <img src={cover.url} alt="" className="aspect-square w-full bg-[#ddd] object-cover" loading="lazy" />
        ) : (
          <div className="flex aspect-square items-center justify-center bg-[#ddd] text-muted">No photo</div>
        )}
        {listing.phase === "live" && isFinalChance(listing.extensionCount) && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-[#fef08a]/80 px-2 py-0.5 text-xs font-bold text-[#422006] backdrop-blur-[2px]">Final chance to bid</span>
        )}
      </div>
      <div className="space-y-0.5 p-2">
        <p className="line-clamp-2 font-bold">{listing.title}</p>
        <p>
          {formatEur(listing.startingPriceCents)} <span className="text-xs text-muted">starting</span>
        </p>
        {listing.phase === "upcoming" && listing.startsAt ? (
          <p className="text-xs text-muted">
            Starts <LocalTime iso={listing.startsAt} />
          </p>
        ) : (
          listing.endsAt &&
          (listing.phase === "live" && listing.startsAt ? (
            <p className="text-xs">
              <Countdown iso={listing.endsAt} startIso={listing.startsAt} />
            </p>
          ) : (
            <p className="text-xs text-muted">
              Ends <LocalTime iso={listing.endsAt} />
            </p>
          ))
        )}
      </div>
    </Link>
  );
}

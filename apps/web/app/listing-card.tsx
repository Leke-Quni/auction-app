import { formatEur } from "@auction/shared";
import Link from "next/link";
import { LocalTime } from "./local-time";

export interface ListingSummary {
  id: string;
  title: string;
  startingPriceCents: number;
  phase: "draft" | "upcoming" | "live" | "ended";
  startsAt: string | null;
  endsAt: string | null;
  images: { id: string; url: string }[];
}

export function ListingCard({ listing }: { listing: ListingSummary }) {
  const cover = listing.images[0];
  return (
    <Link href={`/listings/${listing.id}`} className="block border border-line bg-white hover:border-brand">
      {cover ? (
        <img src={cover.url} alt="" className="aspect-square w-full bg-[#ddd] object-cover" loading="lazy" />
      ) : (
        <div className="flex aspect-square items-center justify-center bg-[#ddd] text-muted">No photo</div>
      )}
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
          listing.endsAt && (
            <p className="text-xs text-muted">
              Ends <LocalTime iso={listing.endsAt} />
            </p>
          )
        )}
      </div>
    </Link>
  );
}

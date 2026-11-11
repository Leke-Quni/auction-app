import { isLowRating } from "@auction/shared";
import Link from "next/link";
import { Stars } from "./stars";

// Who is selling and how buyers rate them, under the photos on a listing: the name (a link to their profile), the average out of
// 5 with filled and empty stars, and a warning when the rating is low. The seller sees their own line without the warning.
export function SellerInfo({ username, average, count, isOwner }: { username: string; average: number | null; count: number; isOwner?: boolean }) {
  return (
    <div className="mt-3 space-y-1 border border-line bg-surface p-2">
      <p>
        <span className="text-xs text-muted">Seller </span>
        <Link href={`/sellers/${username}`} className="font-bold text-brand underline">
          {username}
        </Link>
      </p>
      <p>
        {average === null ? (
          <span className="text-muted">No ratings yet</span>
        ) : (
          <>
            <Stars value={average} /> <b>{average.toFixed(1)}</b>
            <span className="text-muted"> out of 5 ({count} {count === 1 ? "rating" : "ratings"})</span>
          </>
        )}
      </p>
      {!isOwner && isLowRating(average, count) && (
        <p role="alert" className="border border-urgent bg-danger-faint p-2 font-bold text-urgent">
          This seller&apos;s ratings aren&apos;t very good. Be careful before placing any bids.
        </p>
      )}
    </div>
  );
}

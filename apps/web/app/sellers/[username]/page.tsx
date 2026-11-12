import { displayUsername } from "@auction/shared";
import type { SellerProfile } from "@auction/shared";
import { notFound } from "next/navigation";
import { LocalTime } from "@/app/local-time";
import { ListingCard, type ListingSummary } from "@/app/listing-card";
import { Stars } from "@/app/stars";
import { apiFetch } from "@/lib/api";

export default async function SellerPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const res = await apiFetch(`/users/${encodeURIComponent(username)}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /users/${username} failed: ${res.status}`);
  const profile: SellerProfile = await res.json();
  const { average, count } = profile.rating;

  return (
    <div className="space-y-3">
      <div className="space-y-1 border border-line bg-surface p-3">
        <h1 className="text-lg font-bold">{profile.username}</h1>
        <p className="text-muted">
          Member since <LocalTime iso={profile.memberSince} />
        </p>
        <p>
          {average === null ? (
            "No ratings yet"
          ) : (
            <>
              <Stars value={average} /> <b>{average.toFixed(1)}</b> out of 5 · {count} {count === 1 ? "rating" : "ratings"}
            </>
          )}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="border border-line bg-surface p-2 font-bold">For sale now</h2>
        {profile.listings.length === 0 ? (
          <p className="border border-line bg-surface p-3 text-muted">{profile.username} has nothing for sale right now.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {profile.listings.map((listing) => (
              <li key={listing.id} className="flex [&>a]:min-w-0 [&>a]:flex-1">
                <ListingCard listing={listing as unknown as ListingSummary} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="border border-line bg-surface p-2 font-bold">Ratings from buyers</h2>
        {profile.ratings.length === 0 ? (
          <p className="border border-line bg-surface p-3 text-muted">Buyers can rate a seller once their item has been delivered.</p>
        ) : (
          <ul className="divide-y divide-line border border-line bg-surface">
            {profile.ratings.map((r) => (
              <li key={r.id} className="space-y-0.5 p-3">
                <p>
                  <Stars value={r.stars} /> <span className="text-muted">by {displayUsername(r.buyer.username)} · </span>
                  <span className="text-muted">
                    <LocalTime iso={r.createdAt} />
                  </span>
                </p>
                {r.comment && <p className="whitespace-pre-wrap">{r.comment}</p>}
                <p className="text-xs text-muted">For: {r.listingTitle}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

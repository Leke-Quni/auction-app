import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { apiFetch, authedApiFetch } from "@/lib/api";
import { ListingEditor } from "../../listing-editor";

export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photosFailed?: string }>;
}) {
  const { id } = await params;
  const { photosFailed } = await searchParams;
  const session = await auth();
  if (!session) redirect("/sign-in");

  const [listingRes, categoriesRes, defaultRes] = await Promise.all([authedApiFetch(`/listings/${id}`), apiFetch("/categories"), authedApiFetch("/me/pickup-address")]);
  if (listingRes.status === 404) notFound();
  if (!listingRes.ok || !categoriesRes.ok) throw new Error(`API failed: ${listingRes.status} / ${categoriesRes.status}`);
  const listing = await listingRes.json();
  if (listing.seller.id !== session.user.id) notFound();
  if (listing.phase === "ended") redirect(`/listings/${id}`);
  const categories = await categoriesRes.json();
  const defaultPickup = defaultRes.ok ? (await defaultRes.json()).pickupAddress : null;

  return (
    <div className="mx-auto max-w-xl space-y-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">{listing.status === "DRAFT" ? "Edit draft" : "Edit listing"}</h1>
        <Link href={`/listings/${id}`} className="text-brand underline">
          View listing
        </Link>
      </div>
      {listing.status === "DRAFT" && (
        <p role="status" className="border border-l-4 border-time-warn border-l-time-warn bg-warn-soft p-2 font-bold">
          This is a draft of your listing. Confirm the information you provided is correct, then publish.
        </p>
      )}
      {photosFailed && (
        <p className="border border-urgent bg-surface p-2 text-urgent">
          Your draft was created, but the photos could not be saved. Add them again below.
        </p>
      )}
      <ListingEditor
        locked={listing.status === "PUBLISHED" && listing.bidCount > 0}
        categories={categories}
        defaultPickup={defaultPickup}
        userId={session.user.id}
        initialPhotos={listing.images.map((i: { url: string }) => i.url)}
        listing={{
          id: listing.id,
          title: listing.title,
          description: listing.description,
          categoryId: listing.category.id,
          condition: listing.condition,
          startingPriceCents: listing.startingPriceCents,
          reservePriceCents: listing.reservePriceCents,
          durationDays: listing.durationDays,
          pickupAddress: listing.pickupAddress,
          status: listing.status,
        }}
      />
    </div>
  );
}

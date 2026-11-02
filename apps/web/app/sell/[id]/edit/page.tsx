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

  const [listingRes, categoriesRes] = await Promise.all([authedApiFetch(`/listings/${id}`), apiFetch("/categories")]);
  if (listingRes.status === 404) notFound();
  if (!listingRes.ok || !categoriesRes.ok) throw new Error(`API failed: ${listingRes.status} / ${categoriesRes.status}`);
  const listing = await listingRes.json();
  if (listing.seller.id !== session.user.id) notFound();
  const categories = await categoriesRes.json();

  return (
    <div className="mx-auto max-w-xl space-y-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold">{listing.status === "DRAFT" ? "Edit draft" : "Edit listing"}</h1>
        <Link href={`/listings/${id}`} className="text-brand underline">
          View listing
        </Link>
      </div>
      {photosFailed && (
        <p className="border border-urgent bg-white p-2 text-urgent">
          Your draft was created, but the photos could not be saved. Add them again below.
        </p>
      )}
      <ListingEditor
        categories={categories}
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
          status: listing.status,
        }}
      />
    </div>
  );
}

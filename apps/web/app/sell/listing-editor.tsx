"use client";

import { useState, useTransition } from "react";
import { deleteListingAction } from "./actions";
import { ImageUploader } from "./image-uploader";
import { ListingForm, type FormListing } from "./listing-form";
import { PickupAddressEditor } from "./pickup-address-editor";
import { PublishPanel } from "./publish-panel";

function RemoveListing({ listingId }: { listingId: string }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const remove = () => {
    if (!confirm("Remove this listing and its photos? This cannot be undone.")) return;
    setError("");
    startTransition(async () => {
      const result = await deleteListingAction(listingId);
      if (result?.error) setError(result.error);
    });
  };
  return (
    <div className="space-y-2 border border-line bg-white p-3">
      <h2 className="text-sm font-bold">Remove listing</h2>
      {error && <p className="text-urgent">{error}</p>}
      <button onClick={remove} disabled={pending} className="cursor-pointer border border-[#888] bg-white px-3 py-1">
        {pending ? "..." : "Remove listing"}
      </button>
    </div>
  );
}

// The edit page. For a draft the photos sit inside the form, between the details and the price, and save as they
// change. The photo count is kept here so the Publish button knows whether there is anything to publish.
export function ListingEditor({
  categories,
  listing,
  userId,
  initialPhotos,
  defaultPickup,
}: {
  categories: { id: string; name: string }[];
  listing: FormListing;
  userId: string;
  initialPhotos: string[];
  defaultPickup?: FormListing["pickupAddress"];
}) {
  const [count, setCount] = useState(initialPhotos.length);
  const draft = listing.status === "DRAFT";
  const uploader = (
    <ImageUploader listingId={listing.id} userId={userId} initial={initialPhotos} onCountChange={setCount} />
  );

  return (
    <>
      <ListingForm categories={categories} listing={listing} photos={draft ? uploader : undefined} defaultPickup={defaultPickup} />
      {!draft && uploader}
      {!draft && <PickupAddressEditor listingId={listing.id} address={listing.pickupAddress ?? null} />}
      {draft ? (
        <PublishPanel listingId={listing.id} photoCount={count} durationDays={listing.durationDays} />
      ) : (
        <RemoveListing listingId={listing.id} />
      )}
    </>
  );
}

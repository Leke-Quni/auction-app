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

// The edit page. The photos sit inside the form (for a draft between the details and the price) and are saved with
// the Save button, like every other field. Publish counts the photos that are saved, not the ones still being picked.
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
  const draft = listing.status === "DRAFT";
  const [unsaved, setUnsaved] = useState(false);
  const uploader = <ImageUploader userId={userId} initial={initialPhotos} />;

  return (
    <>
      <ListingForm categories={categories} listing={listing} photos={uploader} defaultPickup={defaultPickup} onUnsavedChange={setUnsaved} />
      {!draft && <PickupAddressEditor listingId={listing.id} address={listing.pickupAddress ?? null} />}
      {draft ? (
        <PublishPanel listingId={listing.id} photoCount={initialPhotos.length} unsaved={unsaved} durationDays={listing.durationDays} />
      ) : (
        <RemoveListing listingId={listing.id} />
      )}
    </>
  );
}

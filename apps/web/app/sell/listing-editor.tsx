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
    <div className="space-y-2 border border-line bg-surface p-3">
      <h2 className="text-sm font-bold">Remove listing</h2>
      {error && <p className="text-urgent">{error}</p>}
      <button onClick={remove} disabled={pending} className="cursor-pointer border border-field bg-surface px-3 py-1">
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
  locked = false,
}: {
  categories: { id: string; name: string }[];
  listing: FormListing;
  userId: string;
  initialPhotos: string[];
  defaultPickup?: FormListing["pickupAddress"];
  // A published listing with bids: bidders bid on what they saw, so only the pickup address can change.
  locked?: boolean;
}) {
  const draft = listing.status === "DRAFT";
  const [unsaved, setUnsaved] = useState(false);
  const uploader = <ImageUploader userId={userId} initial={initialPhotos} />;

  if (locked) {
    return (
      <>
        <p role="status" className="border border-brand bg-surface p-2">
          This listing has bids, so its description and photos can no longer change. You can still correct the pickup address.
        </p>
        <PickupAddressEditor listingId={listing.id} address={listing.pickupAddress ?? null} />
      </>
    );
  }

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

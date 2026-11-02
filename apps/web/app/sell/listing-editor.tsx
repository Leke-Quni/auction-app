"use client";

import { useState } from "react";
import { ImageUploader } from "./image-uploader";
import { ListingForm, type FormListing } from "./listing-form";
import { PublishPanel } from "./publish-panel";

// The edit page. For a draft the photos sit inside the form, between the details and the price, and save as they
// change. The photo count is kept here so the Publish button knows whether there is anything to publish.
export function ListingEditor({
  categories,
  listing,
  userId,
  initialPhotos,
}: {
  categories: { id: string; name: string }[];
  listing: FormListing;
  userId: string;
  initialPhotos: string[];
}) {
  const [count, setCount] = useState(initialPhotos.length);
  const draft = listing.status === "DRAFT";
  const uploader = (
    <ImageUploader listingId={listing.id} userId={userId} initial={initialPhotos} onCountChange={setCount} />
  );

  return (
    <>
      <ListingForm categories={categories} listing={listing} photos={draft ? uploader : undefined} />
      {!draft && uploader}
      {draft && <PublishPanel listingId={listing.id} photoCount={count} durationDays={listing.durationDays} />}
    </>
  );
}

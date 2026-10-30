"use client";

import { useState } from "react";
import { ImageUploader } from "./image-uploader";
import { PublishPanel } from "./publish-panel";

// Holds the photo count so the Publish button knows whether there is anything to publish.
export function ListingMedia({
  listingId,
  userId,
  initial,
  canPublish,
  durationDays,
}: {
  listingId: string;
  userId: string;
  initial: string[];
  canPublish: boolean;
  durationDays: number;
}) {
  const [count, setCount] = useState(initial.length);
  return (
    <>
      <ImageUploader listingId={listingId} userId={userId} initial={initial} onCountChange={setCount} />
      {canPublish && <PublishPanel listingId={listingId} photoCount={count} durationDays={durationDays} />}
    </>
  );
}

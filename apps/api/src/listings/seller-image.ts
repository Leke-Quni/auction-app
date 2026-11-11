import { blobPublicHost } from "../config";

// Photos must be uploaded by the seller to our public Blob store, under their own folder.
// The web app does the uploading and deleting (it can authenticate to Blob); the API only checks the URLs.
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
// The upload route only issues tokens for these, so a photo with another ending did not come through it.
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

// Our store when `BLOB_PUBLIC_HOST` names it; otherwise any Vercel Blob public store, which would also let a seller point at a store of
// their own and skip the size and type limits of our upload route.
const isOurBlobHost = (hostname: string) => {
  const pinned = blobPublicHost();
  return pinned ? hostname.toLowerCase() === pinned : hostname.toLowerCase().endsWith(BLOB_HOST_SUFFIX);
};

export function isSellerImage(image: { url: string; pathname: string }, sellerId: string) {
  try {
    const url = new URL(image.url);
    const extension = image.pathname.split(".").pop()?.toLowerCase() ?? "";
    return (
      url.protocol === "https:" &&
      isOurBlobHost(url.hostname) &&
      decodeURIComponent(url.pathname.slice(1)) === image.pathname &&
      image.pathname.startsWith(`listings/${sellerId}/`) &&
      !image.pathname.includes("..") &&
      IMAGE_EXTENSIONS.includes(extension)
    );
  } catch {
    return false;
  }
}

/** True for a photo URL on our store in this user's own folder (what the upload route lets them create). */
export function isOwnImageUrl(url: string, userId: string) {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    return parsed.protocol === "https:" && isOurBlobHost(parsed.hostname) && path.startsWith(`/listings/${userId}/`) && !path.includes("..");
  } catch {
    return false;
  }
}

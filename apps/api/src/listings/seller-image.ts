// Photos must be uploaded by the seller to our public Blob store, under their own folder.
// The web app does the uploading and deleting (it can authenticate to Blob); the API only checks the URLs.
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function isSellerImage(image: { url: string; pathname: string }, sellerId: string) {
  try {
    const url = new URL(image.url);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(BLOB_HOST_SUFFIX) &&
      decodeURIComponent(url.pathname.slice(1)) === image.pathname &&
      image.pathname.startsWith(`listings/${sellerId}/`) &&
      !image.pathname.includes("..")
    );
  } catch {
    return false;
  }
}

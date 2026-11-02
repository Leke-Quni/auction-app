import { del } from "@vercel/blob";

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/** True for a photo in this user's own folder on our public Blob store. */
export function isOwnBlobUrl(url: string, userId: string): boolean {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(BLOB_HOST_SUFFIX) &&
      path.startsWith(`/listings/${userId}/`) &&
      !path.includes("..")
    );
  } catch {
    return false;
  }
}

/**
 * Deletes photos the API reported as removed. The API has no Blob credentials, so the web app does this.
 * Best-effort: a failure is logged and never fails the save, and anything outside the user's own folder is ignored.
 */
export async function deleteOwnBlobs(urls: string[], userId: string, remove: typeof del = del) {
  const own = urls.filter((url) => isOwnBlobUrl(url, userId));
  if (own.length === 0) return;
  try {
    await remove(own);
  } catch (error) {
    console.warn(`Could not delete ${own.length} photo(s) from Blob: ${(error as Error).message}`);
  }
}

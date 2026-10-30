import { del } from "@vercel/blob";
import { Injectable, Logger } from "@nestjs/common";

export const IMAGE_STORAGE = Symbol("IMAGE_STORAGE");

export interface ImageStorage {
  /** Best-effort: a failed delete is logged, never thrown, because the listing change already succeeded. */
  delete(urls: string[]): Promise<void>;
}

@Injectable()
export class BlobImageStorage implements ImageStorage {
  private readonly logger = new Logger("ImageStorage");

  async delete(urls: string[]) {
    if (urls.length === 0) return;
    try {
      await del(urls);
    } catch (error) {
      this.logger.warn(`Could not delete ${urls.length} blob(s): ${(error as Error).message}`);
    }
  }
}

// Photos must be uploaded by the seller to our public Blob store, under their own folder.
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

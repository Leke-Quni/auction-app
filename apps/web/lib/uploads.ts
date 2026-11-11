import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@auction/shared";
import { issueSignedToken } from "@vercel/blob";

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/** The person has asked for permission to upload too many photos lately. */
export class UploadLimitError extends Error {}

export type UploadCheck = { ok: true } | { ok: false; reason: string };

/** Decides whether a signed-in user may get an upload token for this path: their own folder, an image extension. */
export function authorizeUpload(userId: string | undefined, pathname: string): UploadCheck {
  if (!userId) return { ok: false, reason: "Sign in to upload photos" };
  if (!pathname.startsWith(`listings/${userId}/`)) return { ok: false, reason: "Photos must go in your own folder" };
  if (pathname.length > 200 || pathname.includes("..")) return { ok: false, reason: "Invalid file name" };
  const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) return { ok: false, reason: "Only JPG, PNG, and WebP photos are allowed" };
  return { ok: true };
}

const UPLOAD_URL_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Called by the upload route for each photo a browser wants to upload: checks who is asking and where the file
 * would go, then issues a short-lived token that only allows that one upload (images, up to 5 MB).
 * `issue` is replaceable so the rules can be tested without Blob credentials. `reserve` counts the upload against the person's
 * limit (it throws `UploadLimitError` when they are over), after the path is accepted and before anything is issued.
 */
export async function getUploadToken(
  userId: string | undefined,
  pathname: string,
  issue: typeof issueSignedToken = issueSignedToken,
  reserve: () => Promise<void> = async () => {},
) {
  const check = authorizeUpload(userId, pathname);
  if (!check.ok) throw new Error(check.reason);
  await reserve();
  const validUntil = Date.now() + UPLOAD_URL_LIFETIME_MS;
  return {
    token: await issue({
      pathname,
      operations: ["put"],
      allowedContentTypes: [...IMAGE_TYPES],
      maximumSizeInBytes: MAX_IMAGE_BYTES,
      validUntil,
    }),
    urlOptions: {
      access: "public" as const,
      allowedContentTypes: [...IMAGE_TYPES],
      maximumSizeInBytes: MAX_IMAGE_BYTES,
      addRandomSuffix: true,
      allowOverwrite: false,
      validUntil,
    },
  };
}

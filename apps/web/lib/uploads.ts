const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

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

import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { getUploadToken, UploadLimitError } from "@/lib/uploads";

// Browsers upload straight to Vercel Blob. This route only decides who may upload and what.
// It uses presigned uploads, which authenticate to Blob with Vercel's OIDC token (BLOB_STORE_ID plus a
// short-lived VERCEL_OIDC_TOKEN), so no long-lived secret exists. The upload-completed callback is not used.

// Counts this upload against the person's limit, which the API keeps (it has the shared counters). If the API cannot be asked, no
// permission is given: an unchecked upload is what the limit exists to stop.
async function reserveUpload() {
  const res = await authedApiFetch("/uploads/authorize", { method: "POST" });
  if (res.status === 429) throw new UploadLimitError("You have uploaded a lot of photos. Wait a while and try again.");
  if (!res.ok) throw new Error("Photo uploads are unavailable right now. Try again in a moment.");
}

export async function POST(request: Request) {
  let body: HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadPresignedBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const session = await auth();

  try {
    const response = await handleUploadPresigned({
      body,
      request,
      getSignedToken: (pathname) => getUploadToken(session?.user?.id, pathname, undefined, reserveUpload),
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: error instanceof UploadLimitError ? 429 : 400 });
  }
}

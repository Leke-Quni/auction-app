import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUploadToken } from "@/lib/uploads";

// Browsers upload straight to Vercel Blob. This route only decides who may upload and what.
// It uses presigned uploads, which authenticate to Blob with Vercel's OIDC token (BLOB_STORE_ID plus a
// short-lived VERCEL_OIDC_TOKEN), so no long-lived secret exists. The upload-completed callback is not used.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadPresignedBody;
  const session = await auth();

  try {
    const response = await handleUploadPresigned({
      body,
      request,
      getSignedToken: (pathname) => getUploadToken(session?.user?.id, pathname),
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

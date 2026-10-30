import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@auction/shared";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeUpload } from "@/lib/uploads";

// Browsers upload straight to Vercel Blob. This route only decides who may get an upload token.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const session = await auth();

  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const check = authorizeUpload(session?.user?.id, pathname);
        if (!check.ok) throw new Error(check.reason);
        return {
          allowedContentTypes: [...IMAGE_TYPES],
          maximumSizeInBytes: MAX_IMAGE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: session!.user.id }),
        };
      },
      // Vercel cannot reach localhost, so nothing depends on this. The listing save call sends the photo URLs
      // and the API checks them.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

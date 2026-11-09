import { MAX_IMAGES } from "@auction/shared";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteOwnBlobs } from "@/lib/blob";

// The visitor left a listing form without saving: delete the photos they uploaded meanwhile. Only the caller's own
// folder is touched (deleteOwnBlobs checks every URL), and the page sends only photos no listing holds yet.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const urls = body && typeof body === "object" ? (body as { urls?: unknown }).urls : null;
  if (!Array.isArray(urls)) return new NextResponse(null, { status: 400 });
  await deleteOwnBlobs(urls.filter((u): u is string => typeof u === "string").slice(0, MAX_IMAGES), session.user.id);
  return new NextResponse(null, { status: 204 });
}

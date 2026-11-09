import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { deleteOwnBlobs } from "@/lib/blob";

// The visitor left a listing form without saving: delete the photos they uploaded meanwhile. The page sends only photos it believes
// are unsaved, but the API is asked which of them no listing holds (a relisted draft shares photos with its old listing), and only
// those, from the caller's own folder (deleteOwnBlobs checks every URL), are deleted.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const urls = body && typeof body === "object" ? (body as { urls?: unknown }).urls : null;
  if (!Array.isArray(urls)) return new NextResponse(null, { status: 400 });
  const asked = urls.filter((u): u is string => typeof u === "string");
  if (asked.length === 0) return new NextResponse(null, { status: 204 });
  const res = await authedApiFetch("/listing-images/unused", { method: "POST", body: JSON.stringify({ urls: asked }) }).catch(() => null);
  if (!res?.ok) return new NextResponse(null, { status: 502 });
  const { urls: unused } = (await res.json()) as { urls: string[] };
  await deleteOwnBlobs(unused, session.user.id);
  return new NextResponse(null, { status: 204 });
}

import { SUGGESTION_MIN_LENGTH } from "@auction/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiFetch } from "@/lib/api";
import { viewerIpHeaders } from "@/lib/viewer-ip";

// Search suggestions for the header box. Suggestions are a nicety, so any trouble (search down, the API asleep) is an
// empty list and never an error the box has to show.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const none = NextResponse.json({ suggestions: [] }, { headers: { "Cache-Control": "no-store" } });
  if (q.length < SUGGESTION_MIN_LENGTH) return none;
  try {
    const res = await apiFetch(`/search/suggest?q=${encodeURIComponent(q)}`, { headers: await viewerIpHeaders() });
    if (!res.ok) return none;
    const body = await res.json();
    const suggestions = Array.isArray(body?.suggestions) ? body.suggestions.filter((s: unknown) => typeof s === "string") : [];
    return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return none;
  }
}

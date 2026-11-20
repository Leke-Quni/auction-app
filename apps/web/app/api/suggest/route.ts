import { SUGGESTION_MIN_LENGTH } from "@auction/shared";
import { NextResponse, type NextRequest } from "next/server";
import { apiFetch } from "@/lib/api";
import { viewerIpHeaders } from "@/lib/viewer-ip";
import type { SuggestionItem } from "../../search-box";

const isItem = (value: unknown): value is SuggestionItem => {
  const item = value as Partial<SuggestionItem> | null;
  return (
    typeof item?.id === "string" &&
    typeof item.title === "string" &&
    (item.coverUrl === null || typeof item.coverUrl === "string") &&
    typeof item.priceCents === "number" &&
    typeof item.hasBids === "boolean"
  );
};

// Search suggestions for the header box. Suggestions are a nicety, so any trouble (search down, the API asleep) is an
// empty list and never an error the box has to show.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const none = NextResponse.json({ suggestions: [], items: [] }, { headers: { "Cache-Control": "no-store" } });
  if (q.length < SUGGESTION_MIN_LENGTH) return none;
  try {
    const res = await apiFetch(`/search/suggest?q=${encodeURIComponent(q)}`, { headers: await viewerIpHeaders() });
    if (!res.ok) return none;
    const body = await res.json();
    const suggestions = Array.isArray(body?.suggestions) ? body.suggestions.filter((s: unknown) => typeof s === "string") : [];
    const items = Array.isArray(body?.items) ? body.items.filter(isItem) : [];
    return NextResponse.json({ suggestions, items }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return none;
  }
}

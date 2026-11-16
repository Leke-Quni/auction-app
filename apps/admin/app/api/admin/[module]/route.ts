import { auth } from "@/auth";
import { adminApiFetch } from "@/lib/api";
import { ownKey } from "@/lib/search-params";

// The list pages load their rows from here as the visitor pages and filters (the browser has no API token of its own). Only these
// lists are served, and only the query parameters named for each; the API checks the role.
export const LISTS = {
  users: ["q", "banned", "page", "sort", "dir", "f_username", "f_email", "f_status", "f_listings", "f_bids", "f_strikes"],
  listings: ["q", "sellerId", "page", "sort", "dir", "f_title", "f_seller", "f_state", "f_price", "f_bids"],
  orders: ["q", "attention", "page", "sort", "dir", "f_item", "f_price", "f_buyer", "f_seller", "f_status", "f_parcel"],
  audit: ["q", "adminId", "targetId", "page", "sort", "dir", "f_admin", "f_action", "f_target", "f_reason"],
  "question-log": ["q", "questionId", "listingId", "actorId", "page"],
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!ownKey(LISTS, module)) return new Response("Not found.", { status: 404 });
  if (!(await auth())) return new Response("Sign in first.", { status: 401 });
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of LISTS[module]) {
    const value = incoming.get(key);
    if (value) query.set(key, value);
  }
  const res = await adminApiFetch(`/admin/${module}?${query}`);
  if (res.status === 401 || res.status === 403) return new Response("Not allowed.", { status: 403 });
  if (res.status === 400) return new Response("Bad request.", { status: 400 });
  if (!res.ok) return new Response("The API could not load this list. Try again.", { status: 502 });
  return Response.json(await res.json(), { headers: { "Cache-Control": "no-store" } });
}

import { auth } from "@/auth";
import { adminApiFetch } from "@/lib/api";

// Hands an admin the buyer's invoice or the seller's statement of a paid order from the API (the browser has no API token of
// its own). The API checks the role and writes the look to the audit log.
export async function GET(_: Request, { params }: { params: Promise<{ id: string; party: string }> }) {
  const { id, party } = await params;
  if (party !== "buyer" && party !== "seller") return new Response("Not found.", { status: 404 });
  if (!(await auth())) return new Response("Sign in first.", { status: 401 });
  const res = await adminApiFetch(`/admin/orders/${encodeURIComponent(id)}/invoice?party=${party}`);
  if (res.status === 401 || res.status === 403) return new Response("Not allowed.", { status: 403 });
  if (res.status === 404) return new Response("No such order.", { status: 404 });
  if (res.status === 409) return new Response("This order has no invoice yet.", { status: 409 });
  if (!res.ok) return new Response("The API could not produce the invoice. Try again.", { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": res.headers.get("content-disposition") ?? 'attachment; filename="invoice.pdf"' },
  });
}

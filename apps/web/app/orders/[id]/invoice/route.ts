import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

// Hands the buyer or seller their invoice PDF from the API (the browser has no API token of its own).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await auth())) return new Response("Sign in to download the invoice.", { status: 401 });
  const res = await authedApiFetch(`/orders/${id}/invoice`);
  if (!res.ok) return new Response("No invoice for this order.", { status: res.status === 404 ? 404 : 409 });
  return new Response(res.body, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": res.headers.get("content-disposition") ?? 'attachment; filename="invoice.pdf"' },
  });
}

import { VIEWER_IP_HEADER, VIEWER_IP_SIGNATURE_HEADER } from "@auction/shared";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";

// The visitor's address as the host (Vercel) saw it, signed so the API can tell it came from us. Only x-real-ip is
// trusted: x-forwarded-for starts with whatever the client sent, so signing it would let a bot pick its own address.
// Empty when there is no address to pass on (local development without a proxy), and the API then uses the
// connection's own.
export async function viewerIpHeaders(): Promise<Record<string, string>> {
  try {
    const incoming = await headers();
    const ip = incoming.get("x-real-ip");
    if (!ip) return {};
    const signature = createHmac("sha256", process.env.AUTH_SECRET!).update(ip).digest("hex");
    return { [VIEWER_IP_HEADER]: ip, [VIEWER_IP_SIGNATURE_HEADER]: signature };
  } catch {
    return {};
  }
}

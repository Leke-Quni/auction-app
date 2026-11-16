import { VIEWER_IP_HEADER, VIEWER_IP_SIGNATURE_HEADER } from "@auction/shared";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";

const signed = (ip: string) => ({ [VIEWER_IP_HEADER]: ip, [VIEWER_IP_SIGNATURE_HEADER]: createHmac("sha256", process.env.AUTH_SECRET!).update(ip).digest("hex") });

// The visitor's address as the host (Vercel) saw it, signed so the API can tell it came from us. Only x-real-ip is
// trusted: x-forwarded-for starts with whatever the client sent, so signing it would let a bot pick its own address.
// With no address to pass on (local development without a proxy) an empty one is signed: the API's sign-in, sign-up and
// forgot-password limits then count no address rather than this server's own, and everything else uses the connection's.
export async function viewerIpHeaders(): Promise<Record<string, string>> {
  try {
    const incoming = await headers();
    return signed(incoming.get("x-real-ip") ?? "");
  } catch {
    return signed("");
  }
}

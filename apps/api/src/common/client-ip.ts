import { VIEWER_IP_HEADER, VIEWER_IP_SIGNATURE_HEADER } from "@auction/shared";
import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "../config";

export const signViewerIp = (ip: string) => createHmac("sha256", authSecret()).update(ip).digest("hex");

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

// Bids reach the API from the web server, not from the bidder's browser, so the connection's address is the web
// server's. The web server passes on the bidder's address signed with the shared secret; anyone else calling the API
// directly cannot make up an address, so a bad or missing signature falls back to the connection's own.
export function signedClientIp(req: RequestLike): string | null {
  const ip = req.headers[VIEWER_IP_HEADER];
  const signature = req.headers[VIEWER_IP_SIGNATURE_HEADER];
  if (typeof ip === "string" && typeof signature === "string" && ip.length <= 64) {
    const expected = Buffer.from(signViewerIp(ip));
    const given = Buffer.from(signature);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return ip;
  }
  return null;
}

export const clientIp = (req: RequestLike): string | null => signedClientIp(req) ?? req.ip ?? null;

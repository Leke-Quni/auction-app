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
// The address header when its signature is right. An empty one, signed, is the web server saying it has no visitor address to pass
// on (local development without a proxy).
function vouchedIp(req: RequestLike): string | null {
  const ip = req.headers[VIEWER_IP_HEADER];
  const signature = req.headers[VIEWER_IP_SIGNATURE_HEADER];
  if (typeof ip === "string" && typeof signature === "string" && ip.length <= 64) {
    const expected = Buffer.from(signViewerIp(ip));
    const given = Buffer.from(signature);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return ip;
  }
  return null;
}

export const signedClientIp = (req: RequestLike): string | null => vouchedIp(req) || null;

export const clientIp = (req: RequestLike): string | null => signedClientIp(req) ?? req.ip ?? null;

// For the per-address limits on sign-in, sign-up and forgot-password: the signed address, else the connection's own for a direct
// caller. A request from the web server without an address gets none, as its connection address is the web server's, shared by everyone.
export const authClientIp = (req: RequestLike): string | null => {
  const vouched = vouchedIp(req);
  return vouched === null ? (req.ip ?? null) : vouched || null;
};

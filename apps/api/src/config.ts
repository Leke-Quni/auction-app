import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(__dirname, "../../../.env") });

export function authSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(secret);
}

export const webUrl = () => process.env.WEB_URL ?? "http://localhost:3000";

export const redisUrl = () => process.env.REDIS_URL || undefined;

const intFromEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// Bid attempts allowed per minute, counting refused ones too. Read on every call so tests can change them.
export const bidLimits = () => ({ perUser: intFromEnv("BID_LIMIT_USER", 10), perIp: intFromEnv("BID_LIMIT_IP", 30) });

// How many proxies sit in front of the API and may be believed about the caller's address (Fly's proxy is one).
export const trustedProxies = () => intFromEnv("TRUST_PROXY", 0);

export const loginCodeCooldownSeconds = () => intFromEnv("LOGIN_CODE_COOLDOWN_SECONDS", 30);

// How long an outbid email waits before it is sent (so a bidding war can collapse into one), and how long after one
// is sent before another for the same person and auction.
export const outbidEmailDelaySeconds = () => intFromEnv("OUTBID_EMAIL_DELAY_SECONDS", 180);
export const outbidEmailQuietSeconds = () => intFromEnv("OUTBID_EMAIL_QUIET_SECONDS", 900);

// How often one auction's price and bid count are pushed to the search index (an extension is pushed at once).
export const searchPriceThrottleSeconds = () => intFromEnv("SEARCH_PRICE_THROTTLE_SECONDS", 5);

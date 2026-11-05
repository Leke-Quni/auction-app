import { DEFAULT_DELIVERY_RULE, DEFAULT_PLATFORM_FEE_CAP_CENTS, DEFAULT_PLATFORM_FEE_PERCENT, PAYMENT_WINDOW_HOURS, type DeliveryRule } from "@auction/shared";
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

// The platform's share of a sale, taken from the seller, and how long the winner has to pay.
export const platformFeePercent = () => {
  const value = Number.parseFloat(process.env.PLATFORM_FEE_PERCENT ?? "");
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_PLATFORM_FEE_PERCENT;
};
// The most the platform takes from one sale, however high the price.
export const platformFeeCapCents = () => intFromEnv("PLATFORM_FEE_CAP_CENTS", DEFAULT_PLATFORM_FEE_CAP_CENTS);
// What the buyer pays for delivery: a percentage of the item price (kept between a minimum and a maximum) plus the option's
// extra. The platform keeps it and pays the carrier. Read on every call so tests can change them.
export const deliveryRule = (): DeliveryRule => {
  const percent = Number.parseFloat(process.env.DELIVERY_PERCENT ?? "");
  return {
    percent: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : DEFAULT_DELIVERY_RULE.percent,
    minCents: intFromEnv("DELIVERY_MIN_CENTS", DEFAULT_DELIVERY_RULE.minCents),
    maxCents: intFromEnv("DELIVERY_MAX_CENTS", DEFAULT_DELIVERY_RULE.maxCents),
  };
};
// How long the fake carrier takes to pick a parcel up (label created to in transit) and to deliver it (from the label).
// Real carriers take days; these default to minutes so the whole path can be watched. Read on every call so tests can change them.
export const fakeCarrierTimes = () => ({
  inTransitAfterSeconds: intFromEnv("FAKE_CARRIER_IN_TRANSIT_SECONDS", 60),
  deliveredAfterSeconds: intFromEnv("FAKE_CARRIER_DELIVERED_SECONDS", 180),
});
// How long after delivery a seller's share is paid out, and the country their connected payment account is created in (Stripe
// cannot pay out in Kosovo, Albania or North Macedonia, so test accounts use a supported country).
export const payoutDelayDays = () => intFromEnv("PAYOUT_DELAY_DAYS", 3);
export const connectAccountCountry = () => (process.env.STRIPE_CONNECT_COUNTRY || "de").toLowerCase();
export const paymentWindowHours = () => intFromEnv("PAYMENT_WINDOW_HOURS", PAYMENT_WINDOW_HOURS);

// Stripe test or live keys. With both set the API takes payments through Stripe; without them it uses the in-memory fake.
export const stripeConfig = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY || undefined;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || undefined;
  return secretKey && webhookSecret ? { secretKey, webhookSecret } : undefined;
};

// QStash, which calls the API at the moment an auction ends or an order's payment window runs out, so nothing waits for the
// next sweep (and a stopped Fly machine is woken). All four are needed: the token to publish messages, both signing keys to
// verify the calls that come back (the next key lets Upstash rotate keys without a gap), and the address the API is
// reachable at from the internet. Without them the sweeps alone do the work. `QSTASH_URL` points at the local dev server.
export const qstashConfig = () => {
  const token = process.env.QSTASH_TOKEN || undefined;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY || undefined;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY || undefined;
  const callbackUrl = process.env.API_PUBLIC_URL?.replace(/\/+$/, "") || undefined;
  if (!token || !currentSigningKey || !nextSigningKey || !callbackUrl) return undefined;
  return { token, currentSigningKey, nextSigningKey, callbackUrl, baseUrl: process.env.QSTASH_URL || undefined };
};

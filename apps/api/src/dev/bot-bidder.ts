// Development only: bids on one auction every few seconds as the sample users, through the real HTTP API, so the live
// updates, toasts, emails and search sync can be watched by hand. Run it with:
//   yarn workspace @auction/api bot <listingId> [--every <seconds>] [--max <bids>]
// The sample users come from `yarn workspace @auction/db seed`. It refuses to run against anything but a local API.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { authSecret } from "../config";

const SAMPLE_USERS = 40;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pad = (n: number) => String(n).padStart(2, "0");

const argument = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? fallback : Number(process.argv[at + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} needs a positive number`);
  return value;
};

interface ListingView {
  phase: string;
  title: string;
  seller: { id: string };
  highBidder: { id: string; username: string } | null;
  minimumNextBidCents: number;
  endsAt: string;
}

async function main() {
  const listingId = process.argv[2];
  if (!listingId || listingId.startsWith("--")) throw new Error("Usage: yarn workspace @auction/api bot <listingId> [--every <seconds>] [--max <bids>]");
  const apiUrl = process.env.API_URL ?? "http://localhost:4000";
  if (process.env.NODE_ENV === "production" || !LOCAL_HOSTS.has(new URL(apiUrl).hostname)) {
    throw new Error(`Refusing to run: ${new URL(apiUrl).hostname} is not a local API.`);
  }
  const every = argument("every", 4);
  const max = argument("max", Number.POSITIVE_INFINITY);

  const tokenFor = (n: number) =>
    new SignJWT({ email: `seed-user-${pad(n)}@seed.local`, role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`seed_user_${pad(n)}`)
      .setExpirationTime("1h")
      .sign(authSecret());

  let placed = 0;
  console.log(`Bidding on ${listingId} about every ${every} seconds. Press Ctrl+C to stop.`);
  while (placed < max) {
    const res = await fetch(`${apiUrl}/listings/${listingId}`);
    if (res.status === 404) throw new Error("No such listing.");
    const listing = (await res.json()) as ListingView;
    if (listing.phase !== "live") {
      console.log(`The auction is ${listing.phase}, so there is nothing to bid on. Stopping.`);
      return;
    }

    // Anyone but the seller and the current high bidder (the API refuses both).
    const candidates = Array.from({ length: SAMPLE_USERS }, (_, i) => i + 1).filter((n) => {
      const id = `seed_user_${pad(n)}`;
      return id !== listing.seller.id && id !== listing.highBidder?.id;
    });
    const n = candidates[Math.floor(Math.random() * candidates.length)];
    // Mostly the minimum, sometimes a bit more, the way people bid.
    const amountCents = Math.random() < 0.3 ? Math.ceil((listing.minimumNextBidCents * (1 + Math.random() * 0.15)) / 100) * 100 : listing.minimumNextBidCents;

    const bid = await fetch(`${apiUrl}/listings/${listingId}/bids`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(n)}` },
      body: JSON.stringify({ amountCents, idempotencyKey: randomUUID() }),
    });
    const body = (await bid.json().catch(() => ({}))) as { code?: string; extended?: boolean };
    if (bid.ok) {
      placed++;
      console.log(`#${placed} seed_user_${pad(n)} bid €${(amountCents / 100).toFixed(2)}${body.extended ? " (extended the auction)" : ""}`);
    } else {
      console.log(`seed_user_${pad(n)} was refused: ${body.code ?? bid.status}`);
    }
    await sleep(every * 1000 * (0.7 + Math.random() * 0.6));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

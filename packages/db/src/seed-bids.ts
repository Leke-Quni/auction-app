import { minimumNextBidCents, resolveProxyBid, type ProxyOutcome } from "@auction/shared";

export interface SeedBid {
  listingId: string;
  bidderId: string;
  amountCents: number;
  idempotencyKey: string;
  createdAt: Date;
  // Left out, a bid is a plain one (BID) whose typed maximum is its own amount, so nothing is hidden.
  kind?: "BID" | "AUTO" | "RAISE";
  maxCents?: number | null;
  outcome?: ProxyOutcome | null;
}

// A bidder's current maximum on one auction, as the app keeps it (`AutoBid`).
export interface SeedAutoBid {
  listingId: string;
  bidderId: string;
  maxCents: number;
}

export interface BidsForListing {
  bids: SeedBid[];
  // What the listing row must say so it agrees with its bids (the database checks that it does).
  currentBidCents: number | null;
  bidCount: number;
  highBidderId: string | null;
}

// How many bids a sample auction gets: many have none, a few turn into a bidding war.
const BID_COUNTS = [[0, 30], [1, 25], [2, 15], [3, 10], [5, 10], [8, 6], [14, 3], [25, 1]] as const;

const pickWeighted = <T>(random: () => number, choices: readonly (readonly [T, number])[]) => {
  let roll = random() * choices.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of choices) if ((roll -= weight) < 0) return value;
  return choices[choices.length - 1][0];
};

// Bids for one sample auction, obeying the real rules: the first meets the starting price, each later one is the minimum next bid
// from someone other than the leader, the seller never bids, and the times fall between the start and now (or the end, for an
// ended auction), leaning towards the end as real bidding does. Upcoming auctions get none. Every bulk bid is a maximum equal to
// itself and takes the lead by exactly one step, so these auctions have no hidden maximum; the named scenarios show the rest.
export function generateBids(
  listing: { id: string; sellerId: string; startingPriceCents: number; startsAt: Date; endsAt: Date },
  bidderIds: readonly string[],
  now: number,
  random: () => number,
): BidsForListing {
  const start = listing.startsAt.getTime();
  const end = Math.min(now, listing.endsAt.getTime());
  const eligible = bidderIds.filter((id) => id !== listing.sellerId);
  const wanted = start >= now || end <= start || eligible.length < 2 ? 0 : pickWeighted(random, BID_COUNTS);
  if (wanted === 0) return { bids: [], currentBidCents: null, bidCount: 0, highBidderId: null };

  const times = Array.from({ length: wanted }, () => start + (end - start) * Math.sqrt(random())).sort((a, b) => a - b);
  const bids: SeedBid[] = [];
  let current: number | null = null;
  let last: string | null = null;
  for (let i = 0; i < wanted; i++) {
    const minimum = minimumNextBidCents({ startingPriceCents: listing.startingPriceCents, currentBidCents: current });
    const amount = minimum;
    const candidates: readonly string[] = eligible.filter((id) => id !== last);
    const bidderId = candidates[Math.floor(random() * candidates.length)];
    bids.push({
      listingId: listing.id,
      bidderId,
      amountCents: amount,
      maxCents: amount,
      idempotencyKey: `seed-${listing.id}-${i}`,
      // Strictly increasing, so the history has an unambiguous order.
      createdAt: new Date(Math.floor(times[i]) + i),
    });
    current = amount;
    last = bidderId;
  }
  return { bids, currentBidCents: current, bidCount: wanted, highBidderId: last };
}

// The maximums the app would hold for these bids: for each bidder on each auction, the highest amount they typed (an automatic
// row counts at the amount it reached).
export function autoBidsOf(bids: readonly SeedBid[]): SeedAutoBid[] {
  const best = new Map<string, SeedAutoBid>();
  for (const bid of bids) {
    const key = `${bid.listingId}\n${bid.bidderId}`;
    const typed = bid.kind === "AUTO" ? bid.amountCents : (bid.maxCents ?? bid.amountCents);
    const held = best.get(key);
    if (!held) best.set(key, { listingId: bid.listingId, bidderId: bid.bidderId, maxCents: typed });
    else held.maxCents = Math.max(held.maxCents, typed);
  }
  return [...best.values()];
}

// An auction whose bids went through the real proxy rules: each request is a bidder and the maximum they typed, in order, and
// the rows, price and leader come from `resolveProxyBid`, so they are what the app itself would have saved. A refused request
// is a mistake in the scenario and throws.
export function proxyBids(
  listing: { id: string; startingPriceCents: number; reservePriceCents?: number | null },
  requests: readonly { bidderId: string; maxCents: number; at: Date }[],
): BidsForListing {
  const bids: SeedBid[] = [];
  const maxes = new Map<string, number>();
  let price: number | null = null;
  let leaderId: string | null = null;
  let visible = 0;
  requests.forEach((request, i) => {
    const result = resolveProxyBid({
      startingPriceCents: listing.startingPriceCents,
      reservePriceCents: listing.reservePriceCents ?? null,
      currentBidCents: price,
      leader: leaderId ? { bidderId: leaderId, maxCents: maxes.get(leaderId)! } : null,
      bidderId: request.bidderId,
      maxCents: request.maxCents,
    });
    if (!result.ok) throw new Error(`Proxy scenario ${listing.id}: request ${i} was refused (${result.reason})`);
    let auto = 0;
    let offset = 0;
    for (const row of result.rows) {
      const isRequest = row.kind !== "AUTO" && row.bidderId === request.bidderId;
      bids.push({
        listingId: listing.id,
        bidderId: row.bidderId,
        amountCents: row.amountCents,
        kind: row.kind,
        maxCents: isRequest ? request.maxCents : null,
        outcome: isRequest ? result.outcome : null,
        // The request row keeps its key; the system's rows are named after it.
        idempotencyKey: isRequest ? `seed-${listing.id}-${i}` : `seed-${listing.id}-${i}-auto${auto++}`,
        // Strictly increasing, one millisecond apart inside one request.
        createdAt: new Date(request.at.getTime() + offset++),
      });
    }
    maxes.set(request.bidderId, Math.max(maxes.get(request.bidderId) ?? 0, request.maxCents));
    price = result.priceCents;
    leaderId = result.leaderId;
    visible += result.rows.filter((r) => r.kind !== "RAISE").length;
  });
  return { bids, currentBidCents: price, bidCount: visible, highBidderId: leaderId };
}

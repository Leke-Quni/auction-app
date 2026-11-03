import { minimumNextBidCents } from "@auction/shared";

export interface SeedBid {
  listingId: string;
  bidderId: string;
  amountCents: number;
  idempotencyKey: string;
  createdAt: Date;
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

// Bids for one sample auction, obeying the real rules: the first meets the starting price, each later one meets the
// minimum next bid, nobody outbids themselves, the seller never bids, and the times fall between the start and now
// (or the end, for an ended auction), leaning towards the end as real bidding does. Upcoming auctions get none.
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
    // People like round numbers: often bid up to the next whole euro, sometimes add a little on top.
    let amount = random() < 0.4 ? Math.ceil(minimum / 100) * 100 : minimum;
    if (random() < 0.25) amount += Math.round(minimum * random() * 0.2);
    const candidates: readonly string[] = eligible.filter((id) => id !== last);
    const bidderId = candidates[Math.floor(random() * candidates.length)];
    bids.push({
      listingId: listing.id,
      bidderId,
      amountCents: amount,
      idempotencyKey: `seed-${listing.id}-${i}`,
      // Strictly increasing, so the history has an unambiguous order.
      createdAt: new Date(Math.floor(times[i]) + i),
    });
    current = amount;
    last = bidderId;
  }
  return { bids, currentBidCents: current, bidCount: wanted, highBidderId: last };
}

// Development only: what the bot bidder types. A bid is a maximum. By default the bot types the minimum, now and then a little
// more, the way people bid. In proxy mode it types a hidden maximum between the minimum and five times it, so some bids fall
// below the leader's hidden maximum and are defended, and others beat it: the auction shows both instead of a ladder of minimums.
export function botAmountCents(minimumNextBidCents: number, proxy: boolean, random: () => number = Math.random): number {
  if (proxy) return Math.ceil((minimumNextBidCents * (1 + random() * 4)) / 100) * 100;
  return random() < 0.3 ? Math.ceil((minimumNextBidCents * (1 + random() * 0.15)) / 100) * 100 : minimumNextBidCents;
}

// The n-th sample user made by `yarn workspace @auction/db seed`, named the way the seed names them (four digits wide).
export function sampleUser(n: number): { id: string; email: string } {
  const padded = String(n).padStart(4, "0");
  return { id: `seed_user_${padded}`, email: `seed-user-${padded}@seed.local` };
}

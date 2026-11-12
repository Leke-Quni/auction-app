import { minimumNextBidCents } from "./bids";

// Proxy bidding: the number a bidder types is a hidden maximum. The system bids for them, one increment at a time, only as far
// as needed to stay ahead, up to that maximum. These rules are pure (no database, no clock) so the API, the web app and the
// tests agree. The API reads the rows, calls this inside the listing's row lock and writes what it returns.

// What a request produced for the bidder who made it (their placement) and for the leader it met.
export type ProxyOutcome = "LEADING" | "OUTBID_BY_PROXY" | "MAX_RAISED";

// BID: the row a request produced. AUTO: a row the system placed for the leader. RAISE: a hidden raise of the leader's own
// maximum, kept only so a retry is recognised; its amount is the unchanged price.
export type ProxyRowKind = "BID" | "AUTO" | "RAISE";

export interface ProxyRow {
  bidderId: string;
  amountCents: number;
  kind: ProxyRowKind;
}

export interface ProxyBidInput {
  startingPriceCents: number;
  reservePriceCents: number | null;
  // The price now: null when nobody has bid.
  currentBidCents: number | null;
  // The leader and their maximum. A leader who may not defend (banned, closing, two strikes) is passed with their maximum equal
  // to the price, so they count as a plain bid. Null when nobody has bid.
  leader: { bidderId: string; maxCents: number } | null;
  bidderId: string;
  // What the bidder typed.
  maxCents: number;
}

export type ProxyResult =
  | { ok: false; reason: "TOO_LOW"; minimumNextBidCents: number }
  | { ok: false; reason: "MAX_NOT_HIGHER" }
  | {
      ok: true;
      outcome: ProxyOutcome;
      // In the order they are saved.
      rows: ProxyRow[];
      priceCents: number;
      leaderId: string;
      leaderMaxCents: number;
      leaderChanged: boolean;
      // True when a visible row (BID or AUTO) was created: the price moved or, on a first bid, was set. A hidden raise is not.
      priceChanged: boolean;
    };

// The price after one more step from `priceCents`: the price plus the larger of EUR 1 and 5%.
const stepFrom = (priceCents: number) => minimumNextBidCents({ startingPriceCents: 0, currentBidCents: priceCents });

export function resolveProxyBid(input: ProxyBidInput): ProxyResult {
  const { startingPriceCents, reservePriceCents, currentBidCents: price, leader, bidderId, maxCents } = input;

  let result: Extract<ProxyResult, { ok: true }>;
  if (price === null || leader === null) {
    // The first bid sets the starting price, however high the maximum.
    if (maxCents < startingPriceCents) return { ok: false, reason: "TOO_LOW", minimumNextBidCents: startingPriceCents };
    result = {
      ok: true, outcome: "LEADING", rows: [{ bidderId, amountCents: startingPriceCents, kind: "BID" }],
      priceCents: startingPriceCents, leaderId: bidderId, leaderMaxCents: maxCents, leaderChanged: true, priceChanged: true,
    };
  } else if (leader.bidderId === bidderId) {
    // The leader raising their own maximum: nothing visible changes.
    if (maxCents <= leader.maxCents) return { ok: false, reason: "MAX_NOT_HIGHER" };
    result = {
      ok: true, outcome: "MAX_RAISED", rows: [{ bidderId, amountCents: price, kind: "RAISE" }],
      priceCents: price, leaderId: bidderId, leaderMaxCents: maxCents, leaderChanged: false, priceChanged: false,
    };
  } else {
    const minimum = minimumNextBidCents({ startingPriceCents, currentBidCents: price });
    if (maxCents < minimum) return { ok: false, reason: "TOO_LOW", minimumNextBidCents: minimum };
    const rival = leader.maxCents;
    if (maxCents > rival) {
      // The challenger takes the lead one step above the old leader's maximum, or at their own maximum if that is less than a step.
      const rows: ProxyRow[] = [];
      if (rival > price) rows.push({ bidderId: leader.bidderId, amountCents: rival, kind: "AUTO" });
      const priceNow = Math.min(maxCents, stepFrom(rival));
      rows.push({ bidderId, amountCents: priceNow, kind: "BID" });
      result = { ok: true, outcome: "LEADING", rows, priceCents: priceNow, leaderId: bidderId, leaderMaxCents: maxCents, leaderChanged: true, priceChanged: true };
    } else {
      // The leader defends: a tie goes to the earlier maximum (the leader's), otherwise one step above the challenger.
      const priceNow = maxCents === rival ? rival : Math.min(rival, stepFrom(maxCents));
      result = {
        ok: true, outcome: "OUTBID_BY_PROXY",
        rows: [{ bidderId, amountCents: maxCents, kind: "BID" }, { bidderId: leader.bidderId, amountCents: priceNow, kind: "AUTO" }],
        priceCents: priceNow, leaderId: leader.bidderId, leaderMaxCents: rival, leaderChanged: false, priceChanged: true,
      };
    }
  }

  // The reserve is public, so a leader whose maximum covers it takes the price up to it. The leader's own last visible row is
  // raised to the reserve; a hidden raise cannot be changed, so a new row is added after it.
  if (reservePriceCents !== null && result.leaderMaxCents >= reservePriceCents && result.priceCents < reservePriceCents) {
    const last = result.rows[result.rows.length - 1]!;
    if (last.kind !== "RAISE" && last.bidderId === result.leaderId) last.amountCents = reservePriceCents;
    else result.rows.push({ bidderId: result.leaderId, amountCents: reservePriceCents, kind: "AUTO" });
    result.priceCents = reservePriceCents;
    result.priceChanged = true;
  }
  return result;
}

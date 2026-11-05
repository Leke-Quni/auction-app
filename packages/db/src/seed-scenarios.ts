import { minimumNextBidCents, type ShippingAddress } from "@auction/shared";
import { emptyData, type ListingRow, type NotificationRow, type SeedData, type UserRow } from "./seed-data";
import { makeOrder, payoutFor, ratingFor, strikeFor, type OrderRow } from "./seed-orders";

const MIN = 60_000;
const H = 3_600_000;
const D = 24 * H;
const NOTIFICATION_TTL_MS = 14 * D;

export interface ScenarioContext {
  now: number;
  // The sample accounts. A few are changed here (one is banned), so this runs before they are saved.
  users: UserRow[];
  // A real account that already exists, to be given a bit of everything. Null when only sample accounts are used.
  ownerId: string | null;
  categoryId: (slug: string) => string;
  addresses: readonly ShippingAddress[];
  pickups: readonly ShippingAddress[];
  // Unique numbers for invoices and tracking codes.
  next: () => number;
}

export interface Scenarios {
  data: SeedData;
  // What to tell the person once the seed has run: who to look at for what.
  notes: string[];
}

interface Spec {
  key: string;
  sellerId: string;
  title: string;
  description?: string;
  category?: string;
  condition?: ListingRow["condition"];
  startingPriceCents?: number;
  reservePriceCents?: number | null;
  durationDays?: number;
  // Relative to now, in milliseconds (negative is the past).
  startsIn: number;
  endsIn: number;
  // Each entry places the next minimum bid, in order; the last one is the high bidder. Neighbours must differ.
  bidders?: readonly string[];
  extensionCount?: number;
  photos?: number;
  draft?: boolean;
  // The auction has been closed, with this result.
  closed?: { outcome: "SOLD" | "NO_SALE" | "NO_BIDS"; winnerId?: string | null; finalPriceCents?: number | null };
  removed?: { by: string | null; reason: string };
}

// The named situations an app like this meets, as rows, so every screen has something real to show. Everything has an id that
// starts with "seed_", so the seed can find and remove it again. Nothing here talks to the app: timings follow the app's own
// rules (the 48-hour payment window, the carrier's minutes, the 14-day notification life) so the app's background work
// treats these rows exactly like ones it made itself.
export function buildScenarios(ctx: ScenarioContext): Scenarios {
  const { now, ownerId } = ctx;
  const data = emptyData();
  const notes: string[] = [];
  const U = (i: number) => ctx.users[i % ctx.users.length];
  const at = (offset: number) => new Date(now + offset);
  const owner = ownerId;
  let n = 0;

  const add = (spec: Spec): ListingRow => {
    const id = `seed_scn_${spec.key}`;
    const startingPriceCents = spec.startingPriceCents ?? 2500;
    const startsAt = at(spec.startsIn);
    const endsAt = at(spec.endsIn);
    const bidders = spec.bidders ?? [];
    let current: number | null = null;
    const bidEnd = Math.min(now, endsAt.getTime());
    bidders.forEach((bidderId, i) => {
      if (i > 0 && bidders[i - 1] === bidderId) throw new Error(`Scenario ${spec.key}: ${bidderId} would outbid themselves`);
      if (bidderId === spec.sellerId) throw new Error(`Scenario ${spec.key}: the seller cannot bid`);
      const amount = minimumNextBidCents({ startingPriceCents, currentBidCents: current });
      const span = bidEnd - startsAt.getTime();
      data.bids.push({ listingId: id, bidderId, amountCents: amount, idempotencyKey: `seed-${id}-${i}`, createdAt: new Date(Math.floor(startsAt.getTime() + (span * (i + 1)) / (bidders.length + 1)) + i) });
      current = amount;
    });
    const row: ListingRow = {
      id,
      sellerId: spec.sellerId,
      title: spec.title.slice(0, 80),
      description: spec.description ?? `${spec.title}. Created by the seed to show this situation.`,
      categoryId: ctx.categoryId(spec.category ?? "collectibles"),
      condition: spec.condition ?? "GOOD",
      startingPriceCents,
      reservePriceCents: spec.reservePriceCents ?? null,
      durationDays: spec.durationDays ?? 3,
      pickupAddress: ctx.pickups[n++ % ctx.pickups.length],
      extensionCount: spec.extensionCount ?? 0,
      status: spec.draft ? "DRAFT" : "PUBLISHED",
      startsAt: spec.draft ? null : startsAt,
      endsAt: spec.draft ? null : endsAt,
      publishedAt: spec.draft ? null : new Date(Math.min(startsAt.getTime(), now - H)),
      currentBidCents: current,
      bidCount: bidders.length,
      highBidderId: bidders.length ? bidders[bidders.length - 1] : null,
      createdAt: new Date(Math.min(startsAt.getTime(), now) - 2 * H),
    };
    if (spec.closed) {
      row.closedAt = new Date(Math.min(endsAt.getTime() + 3000, now));
      row.outcome = spec.closed.outcome;
      row.winnerId = spec.closed.winnerId ?? null;
      row.finalPriceCents = spec.closed.finalPriceCents ?? null;
    }
    if (spec.removed) {
      row.removedAt = endsAt;
      row.closedAt = endsAt;
      row.removedById = spec.removed.by;
      row.removalReason = spec.removed.reason;
      row.outcome = bidders.length ? "NO_SALE" : "NO_BIDS";
      row.winnerId = null;
      row.finalPriceCents = null;
    }
    data.listings.push(row);
    const photos = spec.draft ? 0 : (spec.photos ?? 2);
    for (let position = 0; position < photos; position++) {
      data.images.push({ listingId: id, url: `https://picsum.photos/seed/${id}-${position}/640/640`, pathname: `seed/${id}/${position}.jpg`, position });
    }
    return row;
  };

  const lastBid = (listing: ListingRow, bidderId: string) => Math.max(...data.bids.filter((b) => b.listingId === listing.id && b.bidderId === bidderId).map((b) => b.amountCents));
  const note = (userId: string, listing: ListingRow, type: NotificationRow["type"], key: string, payload: object, ageMs = 0, read = false) =>
    data.notifications.push({ id: `${listing.id}_n_${type}_${userId}`, userId, listingId: listing.id, type, key, title: listing.title, data: payload, createdAt: at(-ageMs), expiresAt: at(-ageMs + NOTIFICATION_TTL_MS), ...(read ? { readAt: at(-ageMs + 5 * MIN) } : {}) });
  const orderOf = (listing: ListingRow, extra: Partial<Parameters<typeof makeOrder>[0]> & Pick<Parameters<typeof makeOrder>[0], "buyerId" | "amountCents" | "startedAt" | "status">): OrderRow => {
    const order = makeOrder({ listingId: listing.id, sellerId: listing.sellerId, pickupAddress: listing.pickupAddress as ShippingAddress | null, serial: ctx.next(), now, ...extra });
    data.orders.push(order);
    return order;
  };
  const delivery = (i: number, optionId = "standard") => ({ address: ctx.addresses[i % ctx.addresses.length], optionId });

  // A question and its answer, with the log lines the app would have written, and optional votes.
  let q = 0;
  const ask = (listing: ListingRow, askerId: string, body: string, ageMs: number, extra: { answer?: string; answerAgeMs?: number; editedBody?: string; editedAnswer?: string; deleted?: boolean; votes?: [string, boolean, "QUESTION" | "ANSWER"][] } = {}) => {
    const id = `${listing.id}_q${++q}`;
    const created = at(-ageMs);
    data.questions.push({
      id, listingId: listing.id, askerId, body: extra.editedBody ?? body, createdAt: created,
      ...(extra.answer ? { answer: extra.editedAnswer ?? extra.answer, answeredAt: at(-(extra.answerAgeMs ?? ageMs / 2)) } : {}),
      ...(extra.editedBody ? { editedAt: at(-ageMs / 3) } : {}),
      ...(extra.editedAnswer ? { answerEditedAt: at(-(extra.answerAgeMs ?? ageMs / 2) / 2) } : {}),
      ...(extra.deleted ? { deletedAt: at(-ageMs / 4) } : {}),
    });
    const log = (target: "QUESTION" | "ANSWER", action: "CREATED" | "EDITED" | "DELETED", actorId: string, text: string, when: Date, previousBody?: string) =>
      data.questionLogs.push({ id: `${id}_l${data.questionLogs.length}`, questionId: id, listingId: listing.id, target, action, actorId, body: text, createdAt: when, ...(previousBody ? { previousBody } : {}) });
    log("QUESTION", "CREATED", askerId, body, created);
    if (extra.editedBody) log("QUESTION", "EDITED", askerId, extra.editedBody, at(-ageMs / 3), body);
    if (extra.answer) {
      log("ANSWER", "CREATED", listing.sellerId, extra.answer, at(-(extra.answerAgeMs ?? ageMs / 2)));
      if (extra.editedAnswer) log("ANSWER", "EDITED", listing.sellerId, extra.editedAnswer, at(-(extra.answerAgeMs ?? ageMs / 2) / 2), extra.answer);
    }
    if (extra.deleted) log("QUESTION", "DELETED", askerId, body, at(-ageMs / 4));
    for (const [userId, liked, target] of extra.votes ?? []) data.votes.push({ id: `${id}_v${userId}${target}`, questionId: id, userId, target, liked, createdAt: at(-ageMs / 5) });
    return { id, createdAt: created };
  };
  const report = (question: { id: string; createdAt: Date }, listing: ListingRow, target: "QUESTION" | "ANSWER", reporterId: string | null, reason: "SPAM" | "ABUSE" | "CONTACT_DETAILS" | "OTHER", body: string, ageMs: number, handled = false) =>
    data.reports.push({ id: `${question.id}_r${data.reports.length}`, questionId: question.id, listingId: listing.id, target, reporterId, reason, postedAt: question.createdAt, body, status: handled ? "HANDLED" : "OPEN", createdAt: at(-ageMs), ...(handled ? { handledAt: at(-ageMs / 2) } : {}) });

  // ---- Different kinds of auctions, among the sample accounts ------------------------------------------------------------
  const sellerA = U(0).id;
  const sellerB = U(4).id;
  const bidder = (i: number) => U(5 + i).id;

  add({ key: "extended-twice", sellerId: sellerA, title: "Brass ship's compass: extended twice by late bids", durationDays: 1, startsIn: -23 * H - 40 * MIN, endsIn: 24 * MIN, extensionCount: 2, bidders: [bidder(0), bidder(1), bidder(0), bidder(2), bidder(1), bidder(3)] });
  add({ key: "final-chance", sellerId: sellerB, title: "Signed print: at its last possible end (final chance)", durationDays: 1, startsIn: -47 * H - 50 * MIN, endsIn: 10 * MIN, extensionCount: 30, bidders: [bidder(2), bidder(4), bidder(2), bidder(5)] });
  add({ key: "closing-sale", sellerId: sellerA, title: "Closes in minutes: reserve met, will sell", startingPriceCents: 4000, reservePriceCents: 4300, startsIn: -3 * D + 3 * MIN, endsIn: 3 * MIN, bidders: [bidder(0), bidder(1), bidder(0), bidder(2)] });
  add({ key: "closing-no-sale", sellerId: sellerB, title: "Closes in minutes: reserve not met, will not sell", startingPriceCents: 3000, reservePriceCents: 9000, startsIn: -3 * D + 4 * MIN, endsIn: 4 * MIN, bidders: [bidder(1), bidder(3)] });
  add({ key: "closing-no-bids", sellerId: sellerA, title: "Closes in minutes with no bids", startsIn: -3 * D + 5 * MIN, endsIn: 5 * MIN });
  add({ key: "upcoming-tomorrow", sellerId: sellerB, title: "Starts tomorrow", durationDays: 7, startsIn: D, endsIn: 8 * D });
  add({ key: "upcoming-month", sellerId: sellerA, title: "Starts in four weeks, runs for a month", durationDays: 30, startsIn: 28 * D, endsIn: 58 * D });
  add({ key: "photos-8", sellerId: sellerB, title: "Eight photos, the most a listing may have", photos: 8, startsIn: -D, endsIn: 2 * D, bidders: [bidder(3)] });
  add({ key: "expensive", sellerId: sellerA, title: "A very expensive item, near the highest bid allowed", category: "art", startingPriceCents: 2_500_000, reservePriceCents: 3_000_000, startsIn: -D, endsIn: 2 * D });
  add({ key: "cheapest", sellerId: sellerB, title: "Starting at one euro", startingPriceCents: 100, startsIn: -D, endsIn: 2 * D, bidders: [bidder(4), bidder(5), bidder(4)] });
  add({ key: "long-title", sellerId: sellerA, title: "A listing whose title uses all eighty characters allowed, to see how it wraps", startsIn: -D, endsIn: 2 * D });
  const hot = add({ key: "hot-auction", sellerId: sellerB, title: "Bidding war: sixty bids from twenty people", startingPriceCents: 1000, durationDays: 5, startsIn: -4 * D, endsIn: 20 * H, bidders: Array.from({ length: 60 }, (_, i) => bidder(i % 20)) });
  for (let i = 0; i < Math.min(24, ctx.users.length - 5); i++) data.watches.push({ userId: bidder(i), listingId: hot.id, createdAt: at(-(i + 1) * H) });
  notes.push(`"${hot.title}" has 60 bids and 24 watchers (bid history paging, bidding at volume).`);

  // ---- Questions and answers, and what moderators see of them --------------------------------------------------------------
  const qa = add({ key: "questions", sellerId: sellerA, title: "Questions and answers in every state", startsIn: -2 * D, endsIn: 3 * D, bidders: [bidder(6)] });
  ask(qa, bidder(0), "Does the lid close properly?", 40 * H, { answer: "Yes, it closes with a firm click.", answerAgeMs: 30 * H, votes: [[bidder(1), true, "QUESTION"], [bidder(2), true, "QUESTION"], [bidder(3), false, "QUESTION"], [bidder(1), true, "ANSWER"], [bidder(4), false, "ANSWER"]] });
  ask(qa, bidder(1), "Can you post to Skopje?", 20 * H);
  ask(qa, bidder(2), "What is the exact height?", 36 * H, { answer: "It is 24 cm.", answerAgeMs: 30 * H, editedAnswer: "It is 24.5 cm, measured again." });
  ask(qa, bidder(3), "Is there a certificate", 28 * H, { editedBody: "Is there a certificate of origin?" });
  const phone = ask(qa, bidder(4), "Call me on +38344123456 and I will pay cash", 10 * H);
  report(phone, qa, "QUESTION", null, "CONTACT_DETAILS", "Call me on +38344123456 and I will pay cash", 10 * H);
  const rude = ask(qa, bidder(5), "This is a ridiculous price, you must be a scammer", 9 * H);
  report(rude, qa, "QUESTION", bidder(8), "ABUSE", "This is a ridiculous price, you must be a scammer", 8 * H);
  const spam = ask(qa, bidder(7), "Buy cheap watches at my shop, link in my profile", 70 * H);
  report(spam, qa, "QUESTION", bidder(9), "SPAM", "Buy cheap watches at my shop, link in my profile", 60 * H, true);
  const gone = ask(qa, bidder(10), "A question its writer deleted", 50 * H, { deleted: true });
  report(gone, qa, "QUESTION", bidder(11), "OTHER", "A question its writer deleted", 40 * H);
  const mailed = ask(qa, bidder(12), "Where can I collect it?", 30 * H, { answer: "Write to me at seller@example.com and we can agree.", answerAgeMs: 25 * H });
  report(mailed, qa, "ANSWER", null, "CONTACT_DETAILS", "Write to me at seller@example.com and we can agree.", 25 * H, true);
  notes.push(`"${qa.title}": 9 questions (answered, unanswered, edited, deleted), reports of every reason (open and handled) and their question log.`);

  // ---- Moderation: a banned account, strikes, removed listings -------------------------------------------------------------
  const banned = ctx.users[1];
  banned.bannedAt = at(-2 * D);
  banned.banReason = "Repeated shill bidding on their own listings (seed example)";
  add({ key: "banned-sellers-listing", sellerId: banned.id, title: "Still live, though its seller has been banned", startsIn: -D, endsIn: 2 * D, bidders: [bidder(1), bidder(2)] });
  notes.push(`@${banned.username} is banned (their listing is still live: remove it from the admin app).`);
  for (const [who, count] of [[U(2), 2], [U(3), 1]] as const) {
    for (let i = 1; i <= count; i++) {
      const listing = add({ key: `unpaid-${who.id.slice(-4)}-${i}`, sellerId: sellerB, title: `Won by ${who.username} and never paid for (${i})`, startsIn: -9 * D, endsIn: -6 * D, bidders: [who.id], closed: { outcome: "NO_SALE", winnerId: null, finalPriceCents: null } });
      data.strikes.push(strikeFor(orderOf(listing, { buyerId: who.id, amountCents: listing.currentBidCents!, startedAt: at(-6 * D), status: "EXPIRED" })));
    }
  }
  notes.push(`@${U(2).username} has 2 strikes (blocked from bidding), @${U(3).username} has 1.`);
  add({ key: "removed-with-bids", sellerId: sellerA, title: "Removed by a moderator after it got bids", startsIn: -2 * D, endsIn: -D, bidders: [bidder(6), bidder(7)], removed: { by: owner, reason: "Counterfeit goods (seed example)" } });
  add({ key: "removed-no-bids", sellerId: sellerB, title: "Removed by a moderator before any bid", startsIn: -2 * D, endsIn: -20 * H, removed: { by: owner, reason: "Prohibited item (seed example)" } });
  add({ key: "draft-1", sellerId: sellerA, title: "A draft: private, not yet published", startsIn: 0, endsIn: 0, draft: true });
  add({ key: "draft-2", sellerId: sellerB, title: "Another draft with a reserve", reservePriceCents: 9000, startsIn: 0, endsIn: 0, draft: true });

  // ---- Everything for a real account, so each screen can be tried from a real sign-in -----------------------------------------
  if (owner) {
    const o = owner;
    const closedSale = (key: string, title: string, endedAgo: number, bidders: string[], buyerId: string): ListingRow =>
      add({ key, sellerId: sellerA, title, startsIn: -endedAgo - 3 * D, endsIn: -endedAgo, bidders, closed: { outcome: "SOLD", winnerId: buyerId, finalPriceCents: null } });
    const sold = (key: string, title: string, endedAgo: number, bidders: string[], buyerId: string): ListingRow => {
      const l = closedSale(key, title, endedAgo, bidders, buyerId);
      l.finalPriceCents = l.currentBidCents;
      return l;
    };

    // Won, waiting for payment. The 22-hour one gets its "24 hours left" reminder (an email, a bell entry, a toast) at the next sweep.
    const w1 = sold("owner-won-reminder", "You won: 22 hours left to pay (the reminder fires soon)", 26 * H, [bidder(0), o], o);
    const w1o = orderOf(w1, { buyerId: o, amountCents: w1.currentBidCents!, startedAt: at(-26 * H), status: "AWAITING_PAYMENT" });
    note(o, w1, "WON", `won:${w1.id}`, { listingId: w1.id, title: w1.title, finalPriceCents: w1.currentBidCents, orderId: w1o.id }, 26 * H);
    const w2 = sold("owner-won-fresh", "You won: just ended, delivery already chosen", 8 * H, [bidder(1), o], o);
    const w2o = orderOf(w2, { buyerId: o, amountCents: w2.currentBidCents!, startedAt: at(-8 * H), status: "AWAITING_PAYMENT", delivery: { ...delivery(1, "express"), trackingEmails: true } });
    note(o, w2, "WON", `won:${w2.id}`, { listingId: w2.id, title: w2.title, finalPriceCents: w2.currentBidCents, orderId: w2o.id }, 8 * H, true);

    // Offered on: the first buyer did not pay, so the item is offered to you at your own highest bid.
    const w3 = add({ key: "owner-offered", sellerId: sellerB, title: "Offered to you: the first buyer did not pay", startsIn: -58 * H - 3 * D, endsIn: -58 * H, bidders: [o, bidder(2)] });
    const mine = lastBid(w3, o);
    w3.closedAt = at(-58 * H + 3000);
    w3.outcome = "SOLD";
    w3.winnerId = o;
    w3.finalPriceCents = mine;
    const first = orderOf(w3, { buyerId: bidder(2), amountCents: w3.currentBidCents!, startedAt: at(-58 * H), status: "EXPIRED" });
    data.strikes.push(strikeFor(first));
    const offered = orderOf(w3, { round: 2, buyerId: o, amountCents: mine, startedAt: first.payBy, status: "AWAITING_PAYMENT" });
    note(o, w3, "WON", `won:${w3.id}`, { listingId: w3.id, title: w3.title, finalPriceCents: mine, orderId: offered.id, offered: true }, 10 * H);

    // Paid, and the parcel at every stage. The one whose label was made seconds ago moves on by itself while the API runs.
    const p1 = sold("owner-paid-unshipped", "Paid: waiting for the seller to ship", 30 * H, [bidder(3), o], o);
    orderOf(p1, { buyerId: o, amountCents: p1.currentBidCents!, startedAt: at(-30 * H), status: "PAID", paidAt: at(-24 * H), delivery: delivery(2) });
    const p2 = sold("owner-paid-shipping-now", "Paid: label created seconds ago, the fake carrier will deliver it", 3 * D, [bidder(4), o], o);
    orderOf(p2, { buyerId: o, amountCents: p2.currentBidCents!, startedAt: at(-3 * D), status: "PAID", paidAt: at(-2 * D), delivery: { ...delivery(3, "insured"), trackingEmails: true }, labelAt: at(-20_000) });
    const p3 = sold("owner-delivered", "Delivered yesterday: you can rate the seller", 5 * D, [bidder(5), o], o);
    orderOf(p3, { buyerId: o, amountCents: p3.currentBidCents!, startedAt: at(-5 * D), status: "PAID", paidAt: at(-4.5 * D), delivery: delivery(0), labelAt: at(-D) });
    const p4 = sold("owner-delivered-rated", "Delivered and rated five stars, seller paid out", 12 * D, [bidder(6), o], o);
    const p4o = orderOf(p4, { buyerId: o, amountCents: p4.currentBidCents!, startedAt: at(-12 * D), status: "PAID", paidAt: at(-11.5 * D), delivery: delivery(1, "express"), labelAt: at(-11 * D) });
    data.ratings.push(ratingFor(p4o, 5, "Quick and careful. Would buy from you again.", at(-9 * D)));
    data.payouts.push(payoutFor(p4o, new Date(p4o.deliveredAt!.getTime() + 3 * D + 2 * H), ctx.next()));
    // Not paid in time: one strike (two would block bidding).
    const x = add({ key: "owner-unpaid", sellerId: sellerA, title: "You won it and did not pay: a strike", startsIn: -9 * D, endsIn: -6 * D, bidders: [o], closed: { outcome: "NO_SALE", winnerId: null, finalPriceCents: null } });
    data.strikes.push(strikeFor(orderOf(x, { buyerId: o, amountCents: x.currentBidCents!, startedAt: at(-6 * D), status: "EXPIRED" })));

    // Bidding: leading, outbid (with the notice in the bell), and an auction at its final chance.
    add({ key: "owner-leading", sellerId: sellerB, title: "You are the highest bidder", startsIn: -D, endsIn: 2 * D, bidders: [bidder(7), o] });
    const outbid = add({ key: "owner-outbid", sellerId: sellerA, title: "You were outbid", startsIn: -D, endsIn: D, bidders: [o, bidder(8)] });
    note(o, outbid, "OUTBID", `outbid:${outbid.id}`, { listingId: outbid.id, title: outbid.title, currentBidCents: outbid.currentBidCents, minimumNextBidCents: minimumNextBidCents({ startingPriceCents: outbid.startingPriceCents, currentBidCents: outbid.currentBidCents }), endsAt: outbid.endsAt!.toISOString(), extended: false, extensionCount: 0 }, 3 * H);
    const fc = add({ key: "owner-final-chance", sellerId: sellerB, title: "Final chance: this auction cannot be extended again", durationDays: 1, startsIn: -47 * H - 45 * MIN, endsIn: 15 * MIN, extensionCount: 30, bidders: [bidder(9), o, bidder(10)] });
    note(o, fc, "AUCTION_EXTENDED", `extended:${fc.id}`, { listingId: fc.id, title: fc.title, endsAt: fc.endsAt!.toISOString(), extensionCount: 30, final: true }, 40 * MIN);
    // A live close for you to watch: it ends in four minutes and your bid is the top one, above the reserve, so you win it.
    add({ key: "owner-closing-win", sellerId: sellerA, title: "Closes in four minutes and you are winning: watch it close", startingPriceCents: 4000, reservePriceCents: 5000, startsIn: -3 * D + 4 * MIN, endsIn: 4 * MIN, bidders: [bidder(0), o, bidder(0), o, bidder(0), o] });

    // The watchlist, with the reminder for the one ending in about a day queued to go out in two minutes.
    const dayLeft = add({ key: "owner-watch-day", sellerId: sellerB, title: "Watched: ends in 25 hours (the ending-soon email goes out soon)", startsIn: -2 * D, endsIn: 25 * H, bidders: [bidder(11)] });
    data.pendingEmails.push({ id: `${dayLeft.id}_e`, userId: o, listingId: dayLeft.id, kind: "ENDING_SOON", dueAt: at(2 * MIN) });
    const watched = [dayLeft, add({ key: "owner-watch-hours", sellerId: sellerA, title: "Watched: ends in two hours", startsIn: -D, endsIn: 2 * H, bidders: [bidder(12), bidder(13)] }), add({ key: "owner-watch-upcoming", sellerId: sellerB, title: "Watched: starts in three days", startsIn: 3 * D, endsIn: 6 * D }), add({ key: "owner-watch-ended", sellerId: sellerA, title: "Watched: already ended with no bids", startsIn: -5 * D, endsIn: -2 * D, closed: { outcome: "NO_BIDS" } }), hot];
    watched.forEach((l, i) => data.watches.push({ userId: o, listingId: l.id, createdAt: at(-(i + 1) * H) }));

    // Questions you asked, one answered (with the bell entry) and one waiting.
    const answered = ask(qa, o, "Is the original box included?", 12 * H, { answer: "Yes, with the manual and both keys.", answerAgeMs: 2 * H });
    ask(qa, o, "Would you accept pickup in Prizren?", 5 * H);
    note(o, qa, "QUESTION_ANSWERED", `answer:${answered.id}`, { listingId: qa.id, questionId: answered.id, title: qa.title, from: U(0).username, excerpt: "Yes, with the manual and both keys." }, 2 * H);

    // You as the seller: every stage of a sale from the other side.
    const seller = (key: string, title: string, spec: Partial<Spec>): ListingRow => add({ key: `owner-sells-${key}`, sellerId: o, title, startsIn: -D, endsIn: 3 * D, ...spec });
    const live = seller("live", "Yours: live with five bids and three questions", { reservePriceCents: 3000, bidders: [bidder(0), bidder(1), bidder(2), bidder(1), bidder(3)] });
    const asked = ask(live, bidder(4), "Is the price negotiable?", 6 * H);
    ask(live, bidder(5), "Does it come with the charger?", 14 * H, { answer: "Yes, original charger.", answerAgeMs: 10 * H });
    ask(live, bidder(6), "How old is it", 20 * H, { answer: "About three years old.", answerAgeMs: 18 * H, editedAnswer: "About three years old, bought new." });
    note(o, live, "QUESTION_ASKED", `question:${asked.id}`, { listingId: live.id, questionId: asked.id, title: live.title, from: U(9).username, excerpt: "Is the price negotiable?" }, 6 * H);
    seller("upcoming", "Yours: starts in two days", { startsIn: 2 * D, endsIn: 5 * D });
    seller("draft", "Yours: a draft not yet published", { draft: true });
    seller("no-bids", "Yours: ended with no bids (list it again)", { startsIn: -5 * D, endsIn: -2 * D, closed: { outcome: "NO_BIDS" } });
    seller("no-sale", "Yours: ended below the reserve (list it again)", { startsIn: -5 * D, endsIn: -2 * D, reservePriceCents: 9000, bidders: [bidder(7), bidder(8)], closed: { outcome: "NO_SALE" } });
    const s1 = seller("paid", "Yours: sold and paid, ready to ship (mark as shipped)", { startsIn: -4 * D, endsIn: -D, bidders: [bidder(9), bidder(10)], closed: { outcome: "SOLD", winnerId: bidder(10) } });
    s1.finalPriceCents = s1.currentBidCents;
    orderOf(s1, { buyerId: bidder(10), amountCents: s1.currentBidCents!, startedAt: at(-D), status: "PAID", paidAt: at(-20 * H), delivery: delivery(2, "express") });
    const s2 = seller("awaiting", "Yours: sold, the buyer has 30 hours left to pay", { startsIn: -4 * D, endsIn: -18 * H, bidders: [bidder(11), bidder(12)], closed: { outcome: "SOLD", winnerId: bidder(12) } });
    s2.finalPriceCents = s2.currentBidCents;
    orderOf(s2, { buyerId: bidder(12), amountCents: s2.currentBidCents!, startedAt: at(-18 * H), status: "AWAITING_PAYMENT" });
    const s3 = seller("delivered", "Yours: delivered and rated four stars", { startsIn: -12 * D, endsIn: -9 * D, bidders: [bidder(13), bidder(14)], closed: { outcome: "SOLD", winnerId: bidder(14) } });
    s3.finalPriceCents = s3.currentBidCents;
    const s3o = orderOf(s3, { buyerId: bidder(14), amountCents: s3.currentBidCents!, startedAt: at(-9 * D), status: "PAID", paidAt: at(-8.5 * D), delivery: delivery(3), labelAt: at(-8 * D) });
    data.ratings.push(ratingFor(s3o, 4, "Good item, packed well. Shipping took a few days.", at(-6 * D)));
    seller("removed", "Yours: removed by a moderator", { startsIn: -2 * D, endsIn: -D, bidders: [bidder(15)], removed: { by: o, reason: "Not allowed on the site (seed example)" } });

    notes.push("Your account has: 2 purchases waiting for payment (one gets the 24-hour reminder soon), an offer from a non-payer, paid orders at every parcel stage, a rated order, a strike, bids (leading, outbid, final chance), an auction that closes in 4 minutes with you winning, a watchlist, notifications, questions, and your own listings in every stage.");
  } else {
    notes.push("No --owner given, so no scenario data was attached to a real account (pay-now, watchlist, bell, your own listings).");
  }
  return { data, notes };
}

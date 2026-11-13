import { resolveProxyBid } from "@auction/shared";
import { describe, expect, it } from "vitest";
import type { SeedData, UserRow } from "./seed-data";
import { autoBidsOf } from "./seed-bids";
import { buildScenarios } from "./seed-scenarios";

const now = Date.parse("2026-11-05T12:00:00Z");
const address = { name: "Arta Krasniqi", line1: "Rr. Dardania 12", city: "Prizren", postcode: "20000", country: "XK" as const, phone: "+38344123456" };
const users: UserRow[] = Array.from({ length: 40 }, (_, i) => ({
  id: `seed_user_${String(i + 1).padStart(4, "0")}`, email: `u${i}@seed.local`, firstName: "A", lastName: "B", username: `user${i}`, passwordHash: "!x", emailVerified: new Date(now),
}));
const run = (ownerId: string | null, count = users.length) => {
  let serial = 0;
  const copy = users.slice(0, count).map((u) => ({ ...u }));
  return { users: copy, ...buildScenarios({ now, users: copy, ownerId, categoryId: (slug) => `cat_${slug}`, addresses: [address], pickups: [address], next: () => ++serial }) };
};

describe("buildScenarios", () => {
  const withOwner = run("real_owner");
  const without = run(null);

  it("gives every row an id the seed can find again, and no id twice", () => {
    for (const { data } of [withOwner, without]) {
      const ids = data.listings.map((l) => l.id);
      expect(ids.every((id) => id.startsWith("seed_"))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      for (const key of ["orders", "questions", "reports", "questionLogs", "votes", "notifications", "strikes", "ratings", "payouts"] as const) {
        const rowIds = data[key].map((r) => r.id);
        expect(new Set(rowIds).size, key).toBe(rowIds.length);
        expect(rowIds.every((id) => id.startsWith("seed_")), key).toBe(true);
      }
      expect(data.bids.every((b) => b.listingId.startsWith("seed_"))).toBe(true);
    }
  });

  it("only touches real accounts when an owner is given, and then only through rows tied to seed listings", () => {
    const touches = (data: SeedData) => [...data.orders.flatMap((o) => [o.buyerId, o.sellerId]), ...data.listings.map((l) => l.sellerId), ...data.bids.map((b) => b.bidderId), ...data.notifications.map((n) => n.userId), ...data.watches.map((w) => w.userId), ...data.strikes.map((s) => s.userId)];
    expect(touches(without.data).some((id) => id === "real_owner")).toBe(false);
    expect(touches(withOwner.data).some((id) => id === "real_owner")).toBe(true);
    const ownerListings = new Set(withOwner.data.listings.map((l) => l.id));
    for (const row of [...withOwner.data.orders, ...withOwner.data.strikes, ...withOwner.data.notifications, ...withOwner.data.watches]) expect(ownerListings.has(row.listingId)).toBe(true);
    expect(without.notes.join(" ")).toMatch(/No --owner/);
  });

  it("makes bids that follow the bidding rules: every auction replays through the real proxy rules to the same rows", () => {
    for (const listing of withOwner.data.listings) {
      const bids = withOwner.data.bids.filter((b) => b.listingId === listing.id);
      // A request is a row that is not the system's own; the system's rows are named after the request they answer.
      const requests = bids.filter((b) => b.kind !== "AUTO");
      const maxes = new Map<string, number>();
      let price: number | null = null;
      let leaderId: string | null = null;
      for (const [i, request] of requests.entries()) {
        expect(request.bidderId, listing.id).not.toBe(listing.sellerId);
        expect(request.createdAt.getTime()).toBeLessThanOrEqual(now);
        const result = resolveProxyBid({
          startingPriceCents: listing.startingPriceCents,
          reservePriceCents: listing.reservePriceCents ?? null,
          currentBidCents: price,
          leader: leaderId ? { bidderId: leaderId, maxCents: maxes.get(leaderId)! } : null,
          bidderId: request.bidderId,
          maxCents: request.maxCents ?? request.amountCents,
        });
        if (!result.ok) throw new Error(`${listing.id}: request ${i} would be refused (${result.reason})`);
        // The rows this request left behind: itself and the automatic ones named after it.
        const stored = bids.filter((b) => b.idempotencyKey === request.idempotencyKey || b.idempotencyKey.startsWith(`${request.idempotencyKey}-auto`));
        const sorted = [...stored].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        expect(sorted.map((b) => [b.bidderId, b.amountCents, b.kind ?? "BID"]), listing.id).toEqual(result.rows.map((r) => [r.bidderId, r.amountCents, r.kind]));
        maxes.set(request.bidderId, Math.max(maxes.get(request.bidderId) ?? 0, request.maxCents ?? request.amountCents));
        price = result.priceCents;
        leaderId = result.leaderId;
      }
      const visible = bids.filter((b) => b.kind !== "RAISE");
      expect(listing.bidCount, listing.id).toBe(visible.length);
      expect(listing.currentBidCents, listing.id).toBe(price);
      expect(listing.highBidderId, listing.id).toBe(leaderId);
      // Times never go backwards and never pass now.
      const times = bids.map((b) => b.createdAt.getTime());
      expect(times, listing.id).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it("shows a hidden maximum: the proxy scenario's leader typed far more than the price, and no one else can see it in a bid", () => {
    const listing = withOwner.data.listings.find((l) => l.id === "seed_scn_proxy-defended")!;
    const bids = withOwner.data.bids.filter((b) => b.listingId === listing.id);
    const held = new Map(autoBidsOf(withOwner.data.bids).filter((a) => a.listingId === listing.id).map((a) => [a.bidderId, a.maxCents]));
    expect(held.get(listing.highBidderId!)).toBe(8000);
    expect(listing.currentBidCents).toBe(5250);
    // The maximum is in no row's amount; the typed ones are only on the rows the bidders themselves placed.
    expect(bids.some((b) => b.amountCents === 8000)).toBe(false);
    expect(bids.filter((b) => b.kind === "AUTO").every((b) => b.maxCents === null && b.outcome === null)).toBe(true);
    expect(bids.filter((b) => b.outcome === "OUTBID_BY_PROXY")).toHaveLength(2);
    expect(listing.bidCount).toBe(bids.length);
  });

  it("holds one maximum per bidder and auction, never below any amount they reached", () => {
    const held = autoBidsOf(withOwner.data.bids);
    expect(new Set(held.map((a) => `${a.listingId}|${a.bidderId}`)).size).toBe(held.length);
    for (const bid of withOwner.data.bids) {
      expect(held.find((a) => a.listingId === bid.listingId && a.bidderId === bid.bidderId)!.maxCents).toBeGreaterThanOrEqual(bid.amountCents);
    }
  });

  it("covers every kind of order, parcel, strike, notification and report the app has", () => {
    const { data } = withOwner;
    expect(new Set(data.orders.map((o) => o.status))).toEqual(new Set(["AWAITING_PAYMENT", "PAID", "EXPIRED"]));
    expect(data.orders.some((o) => o.round === 2)).toBe(true);
    expect(new Set(data.orders.map((o) => o.shipmentStatus))).toEqual(new Set([null, "LABEL_CREATED", "DELIVERED"]));
    expect(new Set(data.notifications.map((n) => n.type))).toEqual(new Set(["OUTBID", "AUCTION_EXTENDED", "QUESTION_ASKED", "QUESTION_ANSWERED", "WON"]));
    expect(new Set(data.reports.map((r) => r.reason))).toEqual(new Set(["SPAM", "ABUSE", "CONTACT_DETAILS", "OTHER"]));
    expect(new Set(data.reports.map((r) => r.status))).toEqual(new Set(["OPEN", "HANDLED"]));
    expect(data.reports.some((r) => r.reporterId === null)).toBe(true);
    expect(new Set(data.questionLogs.map((l) => l.action))).toEqual(new Set(["CREATED", "EDITED", "DELETED"]));
    expect(data.listings.some((l) => l.status === "DRAFT")).toBe(true);
    expect(data.listings.some((l) => l.removedAt && l.bidCount > 0)).toBe(true);
    expect(data.listings.some((l) => l.extensionCount === 30)).toBe(true);
    expect(data.listings.some((l) => l.extensionCount > 0 && l.extensionCount < 30)).toBe(true);
    expect(data.pendingEmails.length).toBe(1);
  });

  it("keeps listings, orders and results in step", () => {
    const { data } = withOwner;
    for (const l of data.listings) {
      if (l.status === "DRAFT") expect([l.startsAt, l.endsAt, l.bidCount]).toEqual([null, null, 0]);
      else expect(l.endsAt!.getTime()).toBeGreaterThan(l.startsAt!.getTime());
      if (l.outcome === "SOLD") {
        const live = data.orders.filter((o) => o.listingId === l.id && o.status !== "EXPIRED");
        expect(live.length, l.id).toBe(1);
        expect([live[0].buyerId, live[0].amountCents], l.id).toEqual([l.winnerId, l.finalPriceCents]);
      } else if (l.outcome) {
        expect(data.orders.filter((o) => o.listingId === l.id && o.status !== "EXPIRED"), l.id).toEqual([]);
      }
    }
    for (const s of data.strikes) expect(data.orders.find((o) => o.id === s.orderId)!.status).toBe("EXPIRED");
    for (const o of data.orders.filter((x) => x.status === "EXPIRED")) expect(data.strikes.some((s) => s.orderId === o.id)).toBe(true);
  });

  it("gives the owner the 22-hour reminder case, a runner-up offer, a live close they win, and one strike", () => {
    const { data } = withOwner;
    const mine = data.orders.filter((o) => o.buyerId === "real_owner");
    const reminder = mine.find((o) => o.listingId === "seed_scn_owner-won-reminder")!;
    expect(reminder.payBy.getTime() - now).toBeCloseTo(22 * 3_600_000, -3);
    expect(mine.find((o) => o.listingId === "seed_scn_owner-offered")!.round).toBe(2);
    const closing = data.listings.find((l) => l.id === "seed_scn_owner-closing-win")!;
    expect(closing.endsAt!.getTime() - now).toBe(4 * 60_000);
    expect(closing.highBidderId).toBe("real_owner");
    expect(closing.currentBidCents).toBeGreaterThanOrEqual(closing.reservePriceCents!);
    expect(data.strikes.filter((s) => s.userId === "real_owner")).toHaveLength(1);
    const labelled = mine.find((o) => o.listingId === "seed_scn_owner-paid-shipping-now")!;
    expect(now - labelled.shippedAt!.getTime()).toBe(20_000);
    expect(labelled.shipmentStatus).toBe("LABEL_CREATED");
  });

  it("bans one sample account and blocks another with two strikes", () => {
    const banned = withOwner.users.filter((u) => u.bannedAt);
    expect(banned).toHaveLength(1);
    expect(banned[0].banReason).toBeTruthy();
    const strikes = (id: string) => withOwner.data.strikes.filter((s) => s.userId === id).length;
    expect(strikes(users[2].id)).toBeGreaterThanOrEqual(2);
    expect(strikes(users[3].id)).toBeGreaterThanOrEqual(1);
  });

  it("timestamps notifications to live 14 days", () => {
    for (const n of withOwner.data.notifications) expect(n.expiresAt.getTime() - n.createdAt.getTime()).toBe(14 * 24 * 3_600_000);
  });

  it("never lets a row point at a person who is not in the data (other than the owner)", () => {
    const known = new Set([...users.map((u) => u.id), "real_owner"]);
    const { data } = withOwner;
    for (const id of [...data.bids.map((b) => b.bidderId), ...data.orders.flatMap((o) => [o.buyerId, o.sellerId]), ...data.questions.map((q) => q.askerId), ...data.votes.map((v) => v.userId), ...data.watches.map((w) => w.userId), ...data.listings.map((l) => l.sellerId)]) expect(known.has(id), id).toBe(true);
  });
});

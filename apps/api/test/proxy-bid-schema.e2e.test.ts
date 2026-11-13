import "../src/config";
import { createPrismaClient } from "@auction/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const stamp = Date.now();
const prisma = createPrismaClient();
const ids = { users: [] as string[], listings: [] as string[] };
let categoryId = "";
let counter = 0;

const user = async () => {
  const n = ++counter;
  const row = { id: `pbs_${stamp}_${n}`, email: `pbs-${n}-${stamp}@example.com`, firstName: "Proxy", lastName: "Schema", username: `pbs${n}x${stamp}`, passwordHash: "!test" };
  await prisma.user.create({ data: row });
  ids.users.push(row.id);
  return row.id;
};
const listing = async (sellerId: string) => {
  const l = await prisma.listing.create({
    data: { sellerId, title: `Proxy schema ${stamp}-${++counter}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3 },
  });
  ids.listings.push(l.id);
  return l.id;
};

describe("the proxy bidding tables", () => {
  beforeAll(async () => {
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.bid.deleteMany({ where: { listingId: { in: ids.listings } } });
    await prisma.autoBid.deleteMany({ where: { listingId: { in: ids.listings } } });
    await prisma.listing.deleteMany({ where: { id: { in: ids.listings } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  });

  it("gives every bid a kind of BID, no typed maximum and a strictly rising seq unless told otherwise", async () => {
    const [seller, bidder] = [await user(), await user()];
    const listingId = await listing(seller);
    const a = await prisma.bid.create({ data: { listingId, bidderId: bidder, amountCents: 1000, idempotencyKey: `k1-${stamp}` } });
    const b = await prisma.bid.create({ data: { listingId, bidderId: bidder, amountCents: 1000, idempotencyKey: `k2-${stamp}`, kind: "AUTO", maxCents: null } });
    const c = await prisma.bid.create({ data: { listingId, bidderId: bidder, amountCents: 1000, idempotencyKey: `k3-${stamp}`, kind: "RAISE", maxCents: 5000, outcome: "MAX_RAISED" } });
    expect([a.kind, a.maxCents, a.outcome]).toEqual(["BID", null, null]);
    expect([b.kind, c.kind, c.maxCents, c.outcome]).toEqual(["AUTO", "RAISE", 5000, "MAX_RAISED"]);
    // Equal amounts at the same moment still have a strict order.
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(c.seq).toBeGreaterThan(b.seq);
  });

  it("keeps one maximum per bidder and auction, and it must be positive", async () => {
    const [seller, bidder] = [await user(), await user()];
    const listingId = await listing(seller);
    await prisma.autoBid.create({ data: { listingId, bidderId: bidder, maxCents: 5000 } });
    await expect(prisma.autoBid.create({ data: { listingId, bidderId: bidder, maxCents: 6000 } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.autoBid.upsert({ where: { listingId_bidderId: { listingId, bidderId: bidder } }, create: { listingId, bidderId: bidder, maxCents: 1 }, update: { maxCents: 0 } })).rejects.toThrow();
    expect((await prisma.autoBid.findUniqueOrThrow({ where: { listingId_bidderId: { listingId, bidderId: bidder } } })).maxCents).toBe(5000);
  });

  it("removes a maximum with its listing or account when there are no bids, and still protects one that has bids", async () => {
    const [seller, bidder] = [await user(), await user()];
    const empty = await listing(seller);
    await prisma.autoBid.create({ data: { listingId: empty, bidderId: bidder, maxCents: 5000 } });
    await prisma.listing.delete({ where: { id: empty } });
    expect(await prisma.autoBid.count({ where: { listingId: empty } })).toBe(0);

    const withBid = await listing(seller);
    await prisma.bid.create({ data: { listingId: withBid, bidderId: bidder, amountCents: 1000, idempotencyKey: `k4-${stamp}` } });
    await prisma.autoBid.create({ data: { listingId: withBid, bidderId: bidder, maxCents: 5000 } });
    await expect(prisma.listing.delete({ where: { id: withBid } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: bidder } })).rejects.toThrow();
  });
});

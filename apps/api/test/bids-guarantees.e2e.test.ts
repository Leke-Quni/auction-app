import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MAX_BID_CENTS, MAX_PRICE_CENTS, minimumNextBidCents } from "@auction/shared";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

// What must hold for whoever is the top bidder: only a valid, higher, saved bid may replace them, and nothing else
// (a refused bid, a retry, a crash halfway, a race) can change the listing or lose their bid.
const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

describe("the top bidder is safe", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let categoryId: string;
  let seller: Person;
  const api = () => request(app.getHttpServer());

  interface Person {
    id: string;
    token: string;
  }

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return {
        id: `guarantee_${stamp}_${n}`,
        email: `bidg-${n}-${stamp}@example.com`,
        firstName: "Bid",
        lastName: "Guarantee",
        username: `bg${n}x${stamp}`,
        passwordHash: "!test",
        emailVerified: new Date(),
      };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        token: await new SignJWT({ email: row.email, role: "USER" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(row.id)
          .setExpirationTime("10m")
          .sign(authSecret()),
      })),
    );
  };

  const makeListing = (over: Record<string, unknown> = {}) =>
    prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Guarantee test listing",
        description: "A listing for the top bidder tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 2 * DAY),
        publishedAt: new Date(Date.now() - DAY),
        ...over,
      },
    });

  const bid = (person: Person, listingId: string, amountCents: number, key: string = randomUUID()) =>
    api().post(`/listings/${listingId}/bids`).set("Authorization", `Bearer ${person.token}`).send({ amountCents, idempotencyKey: key });

  // Everything about a listing that a bid can touch, and its bids, as one comparable value.
  const snapshot = async (listingId: string) => {
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    const bids = await prisma.bid.findMany({ where: { listingId }, orderBy: { id: "asc" } });
    return JSON.stringify({ listing, bids });
  };

  const original = {} as { transaction?: Prisma["$transaction"] };
  afterEach(() => {
    if (original.transaction) {
      (prisma as { $transaction: unknown }).$transaction = original.transaction;
      original.transaction = undefined;
    }
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    // Bids and listings first: a listing or an account that has bids cannot be deleted.
    const mine = { email: { startsWith: "bidg-", endsWith: `-${stamp}@example.com` } };
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  it("is not changed in any way by a refused bid", async () => {
    const [top, rival, bystander] = await makePeople(3);
    const listing = await makeListing({ startingPriceCents: 10_000 });
    await bid(top, listing.id, 10_000).expect(201);
    const before = await snapshot(listing.id);

    await bid(rival, listing.id, 10_499).expect(422); // below the minimum
    await bid(rival, listing.id, 1).expect(422);
    await bid(top, listing.id, 10_000).expect(409); // not above their own maximum
    await bid(seller, listing.id, 50_000).expect(403); // the seller's own listing
    await api().post(`/listings/${listing.id}/bids`).set("Authorization", `Bearer ${bystander.token}`).send({ amountCents: "x" }).expect(400);
    await api().post(`/listings/${listing.id}/bids`).send({ amountCents: 20_000, idempotencyKey: randomUUID() }).expect(401);
    const reused = randomUUID();
    await bid(bystander, listing.id, 10_500, reused).expect(201); // a real outbid, then the same key for a different amount
    const afterOutbid = await snapshot(listing.id);
    await bid(bystander, listing.id, 99_999, reused).expect(409);

    expect(await snapshot(listing.id)).toBe(afterOutbid);
    expect(afterOutbid).not.toBe(before);
    expect(JSON.parse(before).listing.highBidderId).toBe(top.id);
  });

  it("is replaced only by a bid that clears the minimum, step by step", async () => {
    const people = await makePeople(8);
    const listing = await makeListing({ startingPriceCents: 1000 });
    let current: number | null = null;
    let topId: string | null = null;
    for (const [i, person] of people.entries()) {
      const minimum = minimumNextBidCents({ startingPriceCents: 1000, currentBidCents: current });
      // Just under the minimum is refused and changes nothing; the top bidder stays.
      await bid(person, listing.id, minimum - 1).expect(422);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).highBidderId).toBe(topId);
      // At the minimum, or any maximum above it, takes over, one step above the old leader's maximum (so at the minimum here).
      const typed = i % 2 === 0 ? minimum : minimum + 37;
      await bid(person, listing.id, typed).expect(201);
      current = minimum;
      topId = person.id;
      const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(row).toMatchObject({ currentBidCents: minimum, highBidderId: topId });
      expect(row.bidCount).toBe(await prisma.bid.count({ where: { listingId: listing.id, kind: { not: "RAISE" } } }));
    }
  });

  it("survives a failure halfway through someone else's bid: nothing is saved and the key is not used up", async () => {
    const [top, rival] = await makePeople(2);
    const listing = await makeListing();
    await bid(top, listing.id, 1000).expect(201);
    const before = await snapshot(listing.id);

    // Make the listing update, the last step of a bid, fail after the bid row has already been inserted.
    original.transaction = prisma.$transaction.bind(prisma) as Prisma["$transaction"];
    type Run = (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => Promise<unknown>;
    const real = original.transaction as unknown as Run;
    const failOnListingUpdate = (tx: unknown) =>
      new Proxy(tx as Record<string, object>, {
        get: (target, property: string) =>
          property === "listing"
            ? new Proxy(target.listing, {
                get: (listingApi, method: string) =>
                  method === "update" ? () => Promise.reject(new Error("the machine stopped")) : (listingApi as Record<string, unknown>)[method],
              })
            : target[property],
      });
    (prisma as { $transaction: unknown }).$transaction = (fn: Parameters<Run>[0], options?: unknown) =>
      real((tx) => fn(failOnListingUpdate(tx)), options);
    const key = randomUUID();
    const failed = await bid(rival, listing.id, 2000, key);
    expect(failed.status).toBe(500);

    expect(await snapshot(listing.id)).toBe(before); // the half-made bid was rolled back
    (prisma as { $transaction: unknown }).$transaction = original.transaction;
    original.transaction = undefined;

    const retry = await bid(rival, listing.id, 2000, key).expect(201); // the same key still works
    expect(retry.body.replayed).toBe(false);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).highBidderId).toBe(rival.id);
  });

  it("is not extended again by a retry of the bid that already extended the auction", async () => {
    const [a] = await makePeople(1);
    const listing = await makeListing({ endsAt: new Date(Date.now() + 90_000) });
    const key = randomUUID();
    await bid(a, listing.id, 1000, key).expect(201);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).extensionCount).toBe(1);
    // Time passes: the auction is now inside its last minute.
    await prisma.listing.update({ where: { id: listing.id }, data: { endsAt: new Date(Date.now() + 30_000) } });
    const before = await snapshot(listing.id);
    const again = await bid(a, listing.id, 1000, key).expect(200);
    expect(again.body).toMatchObject({ replayed: true, extended: false });
    expect(await snapshot(listing.id)).toBe(before);
  });

  it("keeps the bid and its listing together when the seller tries to remove the listing at the same moment", async () => {
    const bidders = await makePeople(30);
    const listings = await Promise.all(bidders.map(() => makeListing()));
    const outcomes = await Promise.all(
      listings.map(async (listing, i) => {
        const [placed, removed] = await Promise.all([
          bid(bidders[i], listing.id, 1000),
          api().delete(`/listings/${listing.id}`).set("Authorization", `Bearer ${seller.token}`),
        ]);
        const bidRows = await prisma.bid.count({ where: { listingId: listing.id } });
        const stillThere = (await prisma.listing.count({ where: { id: listing.id } })) === 1;
        return { placed: placed.status, removed: removed.status, bidRows, stillThere };
      }),
    );
    for (const outcome of outcomes) {
      const bidWon = outcome.placed === 201 && outcome.removed === 409 && outcome.stillThere && outcome.bidRows === 1;
      const removalWon = outcome.placed === 404 && outcome.removed === 200 && !outcome.stillThere && outcome.bidRows === 0;
      expect(bidWon || removalWon, JSON.stringify(outcome)).toBe(true);
    }
  }, 30_000);

  it("gives a clear answer, not a server error, for amounts at the top of the range", async () => {
    const [a, b, c] = await makePeople(3);
    const listing = await makeListing({ startingPriceCents: MAX_PRICE_CENTS });
    // A maximum at the largest bid still starts at the starting price, and the next minimum fits the column.
    const top = await bid(a, listing.id, MAX_BID_CENTS).expect(201);
    expect(top.body.listing).toMatchObject({ currentBidCents: MAX_PRICE_CENTS, minimumNextBidCents: 105_000_000 });
    await bid(b, listing.id, MAX_BID_CENTS + 1).expect(400); // more than the largest bid
    await bid(b, listing.id, 104_999_999).expect(422); // below the minimum
    // The same maximum ties and the earlier one wins, at the cap; after that nothing can outbid it.
    const tie = await bid(b, listing.id, MAX_BID_CENTS).expect(201);
    expect(tie.body).toMatchObject({ outcome: "OUTBID_BY_PROXY", listing: { currentBidCents: MAX_BID_CENTS, highBidderId: a.id, minimumNextBidCents: 1_050_000_000 } });
    expect((await bid(c, listing.id, MAX_BID_CENTS).expect(422)).body.minimumNextBidCents).toBe(1_050_000_000);
    expect(await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({ highBidderId: a.id, currentBidCents: MAX_BID_CENTS, bidCount: 3 });
  });

  it("lets one person's different maximums sent at the same moment only ever raise their own: the highest wins, lower ones that come after it are refused", async () => {
    const [person] = await makePeople(1);
    const listing = await makeListing();
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => bid(person, listing.id, 1000 + i * 500)));
    const statuses = responses.map((res) => res.status);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    expect(responses.filter((res) => res.status === 409).every((res) => res.body.code === "MAX_NOT_HIGHER")).toBe(true);
    // The highest is always accepted, whatever the order they arrived in; the price is still the starting price and counts once.
    expect(await prisma.autoBid.findUniqueOrThrow({ where: { listingId_bidderId: { listingId: listing.id, bidderId: person.id } } })).toMatchObject({ maxCents: 3500 });
    expect(await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({ currentBidCents: 1000, bidCount: 1, highBidderId: person.id });
    expect(await prisma.bid.count({ where: { listingId: listing.id } })).toBe(statuses.filter((status) => status === 201).length);
  });

  describe("the database itself refuses to lose a bid", () => {
    it("will not delete a listing that has bids, or the account that holds the top bid", async () => {
      const [top] = await makePeople(1);
      const listing = await makeListing();
      await bid(top, listing.id, 1000).expect(201);
      await expect(prisma.listing.delete({ where: { id: listing.id } })).rejects.toThrow();
      await expect(prisma.user.delete({ where: { id: top.id } })).rejects.toThrow();
      await expect(prisma.bid.deleteMany({ where: { listingId: listing.id } })).resolves.toBeDefined(); // allowed on its own...
      await expect(prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).resolves.toMatchObject({ bidCount: 1, highBidderId: top.id });
    });

    it("will not let a listing claim a bid without a high bidder", async () => {
      const listing = await makeListing();
      await expect(prisma.listing.update({ where: { id: listing.id }, data: { currentBidCents: 1000, bidCount: 1 } })).rejects.toThrow();
      await expect(prisma.listing.update({ where: { id: listing.id }, data: { bidCount: 3 } })).rejects.toThrow();
    });
  });

  it("does not let a draft's details change if it was published while the edit was being made", async () => {
    const draft = await makeListing({ status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null, startingPriceCents: 5000 });
    const realFindUnique = prisma.listing.findUnique.bind(prisma.listing);
    // The edit reads the listing as a draft; at that moment the seller's own publish goes through.
    const spy = vi.spyOn(prisma.listing, "findUnique").mockImplementationOnce(((args: Parameters<typeof realFindUnique>[0]) =>
      (async () => {
        const row = await realFindUnique(args);
        await prisma.listing.update({
          where: { id: draft.id },
          data: { status: "PUBLISHED", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date() },
        });
        return row;
      })()) as never);
    const res = await api().patch(`/listings/${draft.id}`).set("Authorization", `Bearer ${seller.token}`).send({ startingPriceCents: 100 });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(await prisma.listing.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ startingPriceCents: 5000, status: "PUBLISHED" });
  });
});

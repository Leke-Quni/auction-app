import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { AuctionEndEmailService } from "../src/auctions/auction-end-email.service";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

interface Person {
  id: string;
  email: string;
}

describe("auction ended emails and notification expiry", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let emails: AuctionEndEmailService;
  let categoryId: string;
  let seller: Person;
  const created: string[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];
  let failures = 0;
  const mail: MailSender = {
    async send(to, subject, text) {
      if (failures > 0) {
        failures--;
        throw new Error("mail is down");
      }
      sent.push({ to, subject, text });
    },
  };
  // Only mail about this file's listings: the app's own sweeps also close old sample listings in a shared database.
  // The "did not win" emails; the winner's pay-now email has its own tests.
  const sentFor = (listingId: string) => sent.filter((m) => m.text.includes(`/listings/${listingId}`));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    emails = app.get(AuctionEndEmailService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  beforeEach(() => {
    failures = 0;
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "end-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.pendingOutbidEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.notification.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return { id: `end_${stamp}_${n}`, email: `end-${n}-${stamp}@example.com`, firstName: "End", lastName: "Tester", username: `en${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    });
    await prisma.user.createMany({ data: rows });
    return rows;
  };

  // An ended auction with the given bids (bidder, amount) in order; the last is the high bid.
  const endedAuction = async (bids: [Person, number][], over: Record<string, unknown> = {}) => {
    const last = bids[bids.length - 1];
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: `End test ${counter}`,
        description: "A listing for the ended-email tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - 4 * DAY),
        endsAt: new Date(Date.now() - 1000),
        publishedAt: new Date(Date.now() - 4 * DAY),
        currentBidCents: last?.[1] ?? null,
        bidCount: bids.length,
        highBidderId: last?.[0].id ?? null,
        ...over,
      },
    });
    created.push(listing.id);
    for (const [i, [bidder, amountCents]] of bids.entries()) {
      await prisma.bid.create({ data: { listingId: listing.id, bidderId: bidder.id, amountCents, idempotencyKey: `k${i}-${listing.id}` } });
    }
    return listing;
  };

  it("emails each bidder who did not win once, with the final price, and nobody else", async () => {
    const [anna, ben, cara] = await makePeople(3);
    const listing = await endedAuction([[anna, 1000], [cara, 1100], [anna, 1200], [ben, 1300]]);
    await closer.close(listing.id);
    await emails.sweep();

    const got = sentFor(listing.id);
    expect(got.map((m) => m.to).sort()).toEqual([anna.email, cara.email].sort()); // anna bid twice, one email
    expect(got[0].subject).toBe(`${listing.title} has ended`);
    expect(got[0].text).toContain("you did not win");
    expect(got[0].text).toContain("Final price: €13.00");
    expect(await prisma.pendingEndEmail.count({ where: { listingId: listing.id } })).toBe(0);
  });

  it("sends nothing twice: not on a second close, not on a second sweep", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await endedAuction([[anna, 1000], [ben, 1100]]);
    await Promise.all(Array.from({ length: 10 }, () => closer.close(listing.id)));
    await Promise.all([emails.sweep(), emails.sweep()]);
    await emails.sweep();
    await closer.close(listing.id);
    await emails.sweep();
    expect(sentFor(listing.id)).toHaveLength(1);
  });

  it("tells every bidder, the top one included, when the reserve was not met, and nobody when there were no bids", async () => {
    const [anna, ben] = await makePeople(2);
    const noSale = await endedAuction([[anna, 1000], [ben, 1100]], { reservePriceCents: 5000 });
    const noBids = await endedAuction([]);
    await closer.close(noSale.id);
    await closer.close(noBids.id);
    await emails.sweep();
    const got = sentFor(noSale.id);
    expect(got.map((m) => m.to).sort()).toEqual([anna.email, ben.email].sort());
    expect(got[0].text).toContain("without a sale");
    expect(got[0].text).toContain("Highest bid: €11.00");
    expect(sentFor(noBids.id)).toEqual([]);
    expect(await prisma.pendingEndEmail.count({ where: { listingId: noBids.id } })).toBe(0);
  });

  it("replaces an outbid email that was still waiting, so nobody gets two", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await endedAuction([[anna, 1000], [ben, 1100]]);
    await prisma.pendingOutbidEmail.create({ data: { userId: anna.id, listingId: listing.id, dueAt: new Date(Date.now() + 60_000) } });
    await closer.close(listing.id);
    expect(await prisma.pendingOutbidEmail.count({ where: { listingId: listing.id } })).toBe(0);
    await emails.sweep();
    expect(sentFor(listing.id)).toHaveLength(1);
  });

  it("tries again after a failed send, and gives up after three tries", async () => {
    const [anna, ben] = await makePeople(2);
    const retried = await endedAuction([[anna, 1000], [ben, 1100]]);
    await closer.close(retried.id);
    failures = 1;
    await emails.sweep();
    expect(sentFor(retried.id)).toHaveLength(0);
    expect(await prisma.pendingEndEmail.count({ where: { listingId: retried.id } })).toBe(1); // kept
    const due = () => prisma.pendingEndEmail.updateMany({ where: { listingId: { in: created } }, data: { dueAt: new Date(Date.now() - 1000) } });
    await due();
    await emails.sweep();
    expect(sentFor(retried.id)).toHaveLength(1);

    const hopeless = await endedAuction([[anna, 1000], [ben, 1100]]);
    await closer.close(hopeless.id);
    failures = 100;
    for (let i = 0; i < 4; i++) {
      await due();
      await emails.sweep();
    }
    expect(await prisma.pendingEndEmail.count({ where: { listingId: hopeless.id } })).toBe(0);
    expect(sentFor(hopeless.id)).toHaveLength(0);
  });

  it("expires the auction's notifications at close, keeping each loser's latest outbid notice", async () => {
    const [anna, ben, cara] = await makePeople(3);
    const listing = await endedAuction([[anna, 1000], [cara, 1100], [ben, 1200]]);
    const later = new Date(Date.now() + 10 * DAY);
    const note = (userId: string, type: "OUTBID" | "AUCTION_EXTENDED" | "QUESTION_ASKED", key: string) =>
      prisma.notification.create({ data: { userId, listingId: listing.id, type, key, title: type, data: {}, expiresAt: later } });
    await note(anna.id, "OUTBID", `outbid:${listing.id}`);
    await note(anna.id, "AUCTION_EXTENDED", `extended:${listing.id}`);
    await note(ben.id, "OUTBID", `outbid:${listing.id}`); // outbid earlier, then won
    await note(seller.id, "QUESTION_ASKED", `question:x${listing.id}`);

    await closer.close(listing.id);
    const rows = await prisma.notification.findMany({ where: { listingId: listing.id } });
    const expired = (userId: string, type: string) => rows.find((r) => r.userId === userId && r.type === type)!.expiresAt.getTime() <= Date.now();
    expect(expired(anna.id, "OUTBID")).toBe(false);
    expect(expired(anna.id, "AUCTION_EXTENDED")).toBe(true);
    expect(expired(ben.id, "OUTBID")).toBe(true);
    expect(expired(seller.id, "QUESTION_ASKED")).toBe(true);
  });
});

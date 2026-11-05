import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionCloseService } from "../src/auctions/auction-close.service";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { PaymentReminderService } from "../src/realtime/payment-reminder.service";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
const HOUR = 3_600_000;
let counter = 0;

describe("the 24-hour reminder to pay for a won item", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let closer: AuctionCloseService;
  let reminders: PaymentReminderService;
  let categoryId: string;
  let sellerId: string;
  let failMail = false;
  const created: string[] = [];
  const userIds: string[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({
        send: async (to: string, subject: string, text: string) => {
          if (failMail) throw new Error("mail is down");
          sent.push({ to, subject, text });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    closer = app.get(AuctionCloseService);
    reminders = app.get(PaymentReminderService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    sellerId = (await person()).id;
  });

  afterAll(async () => {
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.notification.deleteMany({ where: { listingId: { in: created } } });
    await prisma.order.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listingId: { in: created } } });
    await prisma.listing.deleteMany({ where: { id: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const person = async () => {
    const n = ++counter;
    const row = { id: `pr_${stamp}_${n}`, email: `pr-${n}-${stamp}@example.com`, firstName: "Pay", lastName: "Reminder", username: `pr${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    await prisma.user.create({ data: row });
    userIds.push(row.id);
    return row;
  };
  const waitFor = async (check: () => Promise<unknown>) => {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timed out");
  };

  // A sold auction with its order waiting for payment, due in `hoursLeft` hours.
  const sale = async (hoursLeft: number) => {
    const buyer = await person();
    const listing = await prisma.listing.create({
      data: {
        sellerId, title: `Reminder lamp ${stamp}-${++counter}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED",
        startsAt: new Date(Date.now() - 4 * DAY), endsAt: new Date(Date.now() - 1000), publishedAt: new Date(Date.now() - 4 * DAY), currentBidCents: 2500, bidCount: 1, highBidderId: buyer.id,
      },
    });
    created.push(listing.id);
    await prisma.bid.create({ data: { listingId: listing.id, bidderId: buyer.id, amountCents: 2500, idempotencyKey: randomUUID() } });
    await closer.close(listing.id);
    // The win notice is saved a moment after the close; wait so the reminder is what is last written.
    await waitFor(() => prisma.notification.findFirst({ where: { userId: buyer.id, key: `won:${listing.id}` } }));
    const order = await prisma.order.findFirstOrThrow({ where: { listingId: listing.id } });
    await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() + hoursLeft * HOUR) } });
    return { buyer, listing, order };
  };
  const mailsTo = (email: string) => sent.filter((m) => m.to === email && /left to pay/.test(m.subject));
  const stored = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const notice = (userId: string, listingId: string) => prisma.notification.findUnique({ where: { userId_key: { userId, key: `won:${listingId}` } } });

  it("emails the buyer once when under 24 hours are left, with the warning and the pay link", async () => {
    const { buyer, listing, order } = await sale(23);
    await reminders.sweep();
    const mails = mailsTo(buyer.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(`23 hours left to pay for ${listing.title}`);
    expect(mails[0].text).toContain("offered to someone else");
    expect(mails[0].text).toContain("strike");
    expect(mails[0].text).toContain(`/orders/${order.id}`);
    expect((await stored(order.id)).payReminderSentAt).toBeInstanceOf(Date);
    await reminders.sweep();
    await reminders.sweep();
    expect(mailsTo(buyer.email)).toHaveLength(1);
  });

  it("replaces the 'you won' notice in the bell with an unread reminder that links to the order", async () => {
    const { buyer, listing, order } = await sale(20);
    await prisma.notification.update({ where: { userId_key: { userId: buyer.id, key: `won:${listing.id}` } }, data: { readAt: new Date() } });
    await reminders.sweep();
    const saved = await notice(buyer.id, listing.id);
    expect(saved).toMatchObject({ type: "WON", readAt: null, data: { reminder: true, orderId: order.id, listingId: listing.id, finalPriceCents: 2500 } });
    expect(await prisma.notification.count({ where: { userId: buyer.id, listingId: listing.id } })).toBe(1);
  });

  it("waits until 24 hours are left, then sends", async () => {
    const { buyer, order } = await sale(30);
    await reminders.sweep();
    expect(mailsTo(buyer.email)).toHaveLength(0);
    expect((await stored(order.id)).payReminderSentAt).toBeNull();
    await prisma.order.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() + 23 * HOUR) } });
    await reminders.sweep();
    expect(mailsTo(buyer.email)).toHaveLength(1);
  });

  it("sends nothing for an order that is paid, expired or already past its deadline", async () => {
    const paid = await sale(10);
    const expired = await sale(10);
    const late = await sale(10);
    await prisma.order.update({ where: { id: paid.order.id }, data: { status: "PAID", paidAt: new Date() } });
    await prisma.order.update({ where: { id: expired.order.id }, data: { status: "EXPIRED" } });
    await prisma.order.update({ where: { id: late.order.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await reminders.sweep();
    for (const s of [paid, expired, late]) expect(mailsTo(s.buyer.email)).toHaveLength(0);
  });

  it("tries again on the next sweep when the email fails, without a notice or a double send", async () => {
    const { buyer, listing, order } = await sale(5);
    await prisma.notification.deleteMany({ where: { userId: buyer.id, listingId: listing.id } });
    failMail = true;
    try {
      await reminders.sweep();
    } finally {
      failMail = false;
    }
    expect((await stored(order.id)).payReminderSentAt).toBeNull();
    expect((await stored(order.id)).payReminderClaimedAt).toBeNull();
    expect(await notice(buyer.id, listing.id)).toBeNull();
    expect(mailsTo(buyer.email)).toHaveLength(0);
    await reminders.sweep();
    expect(mailsTo(buyer.email)).toHaveLength(1);
    expect(await notice(buyer.id, listing.id)).not.toBeNull();
  });

  it("does not lose the reminder when a machine stops after claiming it: a fresh lease is respected, an expired one is taken over", async () => {
    const { buyer, order } = await sale(10);
    await prisma.order.update({ where: { id: order.id }, data: { payReminderClaimedAt: new Date() } });
    await reminders.sweep();
    expect(mailsTo(buyer.email)).toHaveLength(0);
    await prisma.order.update({ where: { id: order.id }, data: { payReminderClaimedAt: new Date(Date.now() - 10 * 60_000) } });
    await reminders.sweep();
    expect(mailsTo(buyer.email)).toHaveLength(1);
    expect((await stored(order.id)).payReminderSentAt).toBeInstanceOf(Date);
  });

  it("does not write to a banned buyer", async () => {
    const { buyer, order } = await sale(10);
    await prisma.user.update({ where: { id: buyer.id }, data: { bannedAt: new Date() } });
    await reminders.sweep();
    expect(mailsTo(buyer.email)).toHaveLength(0);
    expect(await stored(order.id)).toMatchObject({ payReminderSentAt: null, payReminderClaimedAt: null });
  });

  it("words a reminder with minutes left correctly", async () => {
    const { buyer } = await sale(0.5);
    await reminders.sweep();
    expect(mailsTo(buyer.email)[0].subject).toMatch(/^(29|30) minutes left to pay/);
  });
});

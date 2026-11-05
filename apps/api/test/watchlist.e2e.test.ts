import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuctionEndEmailService } from "../src/auctions/auction-end-email.service";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { FakePaymentProvider } from "../src/payments/fake-payment-provider";
import { PAYMENT_PROVIDER } from "../src/payments/payment-provider";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;
let counter = 0;

interface Person {
  id: string;
  email: string;
  token: string;
}

describe("watchlist", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let emails: AuctionEndEmailService;
  let categoryId: string;
  const created: string[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];
  const mail: MailSender = { send: async (to, subject, text) => void sent.push({ to, subject, text }) };
  const api = () => request(app.getHttpServer());
  const as = (p: Person) => ({ Authorization: `Bearer ${p.token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(new FakePaymentProvider())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    emails = app.get(AuctionEndEmailService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    const mine = { email: { startsWith: "wat-", endsWith: `-${stamp}@example.com` } };
    await prisma.pendingEndEmail.deleteMany({ where: { listingId: { in: created } } });
    await prisma.bid.deleteMany({ where: { listing: { seller: mine } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  const makePerson = async (): Promise<Person> => {
    const n = ++counter;
    const row = { id: `wat_${stamp}_${n}`, email: `wat-${n}-${stamp}@example.com`, firstName: "Wat", lastName: "Tester", username: `wa${n}x${stamp}`, passwordHash: "!test", emailVerified: new Date() };
    await prisma.user.create({ data: row });
    return { id: row.id, email: row.email, token: await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret()) };
  };

  const listing = async (seller: Person, over: Record<string, unknown> = {}) => {
    const l = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: `Watch test ${++counter}`,
        description: "A listing for the watchlist tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 7,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 5 * DAY),
        publishedAt: new Date(Date.now() - DAY),
        ...over,
      },
    });
    created.push(l.id);
    return l;
  };

  const watch = (p: Person, id: string) => api().put(`/listings/${id}/watch`).set(as(p));
  const unwatch = (p: Person, id: string) => api().delete(`/listings/${id}/watch`).set(as(p));
  const pending = (userId: string, listingId: string) => prisma.pendingEndEmail.findUnique({ where: { userId_listingId_kind: { userId, listingId, kind: "ENDING_SOON" } } });

  it("watches and stops watching, idempotently, and shows the count and the viewer's own state on the listing", async () => {
    const [seller, a, b] = [await makePerson(), await makePerson(), await makePerson()];
    const l = await listing(seller);
    expect((await watch(a, l.id).expect(200)).body).toEqual({ watching: true, watcherCount: 1 });
    expect((await watch(a, l.id).expect(200)).body).toEqual({ watching: true, watcherCount: 1 });
    expect((await watch(b, l.id).expect(200)).body).toEqual({ watching: true, watcherCount: 2 });
    const asA = (await api().get(`/listings/${l.id}`).set(as(a)).expect(200)).body;
    expect(asA).toMatchObject({ watching: true, watcherCount: 2 });
    const signedOut = (await api().get(`/listings/${l.id}`).expect(200)).body;
    expect(signedOut.watcherCount).toBe(2);
    expect(signedOut).not.toHaveProperty("watching");
    expect((await unwatch(a, l.id).expect(200)).body).toEqual({ watching: false, watcherCount: 1 });
    expect((await unwatch(a, l.id).expect(200)).body).toEqual({ watching: false, watcherCount: 1 });
    expect((await api().get(`/listings/${l.id}`).set(as(a)).expect(200)).body.watching).toBe(false);
  });

  it("refuses signed-out people, the seller, drafts, unknown listings and ended auctions", async () => {
    const [seller, a] = [await makePerson(), await makePerson()];
    const live = await listing(seller);
    await api().put(`/listings/${live.id}/watch`).expect(401);
    expect((await watch(seller, live.id).expect(403)).body.code).toBe("OWN_LISTING");
    const draft = await listing(seller, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    await watch(a, draft.id).expect(404);
    await watch(a, "nope").expect(404);
    const ended = await listing(seller, { startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() - 1000) });
    expect((await watch(a, ended.id).expect(409)).body.code).toBe("NOT_WATCHABLE");
    expect(await prisma.watch.count({ where: { userId: a.id } })).toBe(0);
  });

  it("owes one email 24 hours before the end, only when there is time left to send it, and takes it back when the watch stops", async () => {
    const [seller, a, b] = [await makePerson(), await makePerson(), await makePerson()];
    const far = await listing(seller);
    await watch(a, far.id).expect(200);
    await watch(a, far.id).expect(200);
    expect((await pending(a.id, far.id))!.dueAt.getTime()).toBe(far.endsAt!.getTime() - DAY);
    await unwatch(a, far.id);
    expect(await pending(a.id, far.id)).toBeNull();

    const soon = await listing(seller, { endsAt: new Date(Date.now() + 6 * 3600_000) });
    await watch(b, soon.id).expect(200);
    expect(await pending(b.id, soon.id)).toBeNull();
  });

  it("emails the watcher once when it falls due, with the end time and the current bid", async () => {
    const [seller, a, bidder] = [await makePerson(), await makePerson(), await makePerson()];
    const l = await listing(seller, { currentBidCents: 2500, bidCount: 3, highBidderId: bidder.id, endsAt: new Date(Date.now() + DAY + 60_000) });
    await prisma.bid.create({ data: { listingId: l.id, bidderId: bidder.id, amountCents: 2500, idempotencyKey: `k-${l.id}` } });
    await watch(a, l.id).expect(200);
    await prisma.pendingEndEmail.update({ where: { userId_listingId_kind: { userId: a.id, listingId: l.id, kind: "ENDING_SOON" } }, data: { dueAt: new Date(Date.now() - 1000) } });
    const before = sent.length;
    await emails.sweep();
    await emails.sweep();
    const got = sent.slice(before).filter((m) => m.to === a.email && m.text.includes(`/listings/${l.id}`));
    expect(got).toHaveLength(1);
    expect(got[0].subject).toBe(`Ending soon: ${l.title}`);
    expect(got[0].text).toContain("Current highest bid: €25.00 (3 bids)");
    expect(got[0].text).toContain("ends in about 24 hours");
    expect(await pending(a.id, l.id)).toBeNull();
  });

  it("says how long is really left when the reminder goes out late", async () => {
    const [seller, a] = [await makePerson(), await makePerson()];
    const l = await listing(seller);
    await watch(a, l.id).expect(200);
    await prisma.listing.update({ where: { id: l.id }, data: { endsAt: new Date(Date.now() + 40 * 60_000 + 20_000) } });
    await prisma.pendingEndEmail.update({ where: { userId_listingId_kind: { userId: a.id, listingId: l.id, kind: "ENDING_SOON" } }, data: { dueAt: new Date(Date.now() - 1000) } });
    const before = sent.length;
    await emails.sweep();
    const got = sent.slice(before).filter((m) => m.to === a.email && m.text.includes(`/listings/${l.id}`));
    expect(got).toHaveLength(1);
    expect(got[0].text).toContain("ends in about 40 minutes");
    expect(got[0].text).not.toContain("24 hours");
  });

  it("sends reminders a few sweeps at a time, so a crowd of watchers cannot hold up other mail", async () => {
    const seller = await makePerson();
    const l = await listing(seller);
    const people = await Promise.all(Array.from({ length: 30 }, () => makePerson()));
    await prisma.watch.createMany({ data: people.map((p) => ({ userId: p.id, listingId: l.id })) });
    await prisma.pendingEndEmail.createMany({ data: people.map((p) => ({ userId: p.id, listingId: l.id, kind: "ENDING_SOON" as const, dueAt: new Date(Date.now() - 1000) })) });
    const mine = (from: number) => sent.slice(from).filter((m) => m.text.includes(`/listings/${l.id}`)).length;
    const before = sent.length;
    await emails.sweep();
    expect(mine(before)).toBe(25);
    await emails.sweep();
    expect(mine(before)).toBe(30);
  });

  it("caps how many auctions one person can watch, but lets them watch the same one again", async () => {
    const [seller, a] = [await makePerson(), await makePerson()];
    const first = await listing(seller);
    await watch(a, first.id).expect(200);
    const rows = await Promise.all(Array.from({ length: 199 }, () => listing(seller)));
    await prisma.watch.createMany({ data: rows.map((r) => ({ userId: a.id, listingId: r.id })) });
    const extra = await listing(seller);
    expect((await watch(a, extra.id).expect(409)).body.code).toBe("WATCHLIST_FULL");
    await watch(a, first.id).expect(200);
    await unwatch(a, rows[0].id).expect(200);
    // Several at once cannot slip past the cap: one place is free, so exactly one gets it.
    const racers = await Promise.all([listing(seller), listing(seller), listing(seller)]);
    const results = await Promise.all(racers.map((r) => watch(a, r.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.watch.count({ where: { userId: a.id } })).toBe(200);
    await unwatch(a, racers[0].id);
    await unwatch(a, racers[1].id);
    await unwatch(a, racers[2].id);
    await watch(a, extra.id).expect(200);
  });

  it("sends nothing when the watcher is already winning, stopped watching, or the auction is over", async () => {
    const [seller, winning, left, gone] = [await makePerson(), await makePerson(), await makePerson(), await makePerson()];
    const l = await listing(seller);
    for (const p of [winning, left, gone]) await watch(p, l.id).expect(200);
    await prisma.listing.update({ where: { id: l.id }, data: { highBidderId: winning.id, currentBidCents: 1000, bidCount: 1 } });
    await prisma.bid.create({ data: { listingId: l.id, bidderId: winning.id, amountCents: 1000, idempotencyKey: `k-${l.id}` } });
    await prisma.watch.deleteMany({ where: { userId: left.id, listingId: l.id } });
    await prisma.pendingEndEmail.updateMany({ where: { listingId: l.id, kind: "ENDING_SOON" }, data: { dueAt: new Date(Date.now() - 1000) } });
    await prisma.listing.update({ where: { id: l.id }, data: { endsAt: new Date(Date.now() - 500) } });
    const before = sent.length;
    await emails.sweep();
    expect(sent.slice(before).filter((m) => m.text.includes(`/listings/${l.id}`))).toHaveLength(0);
    expect(await pending(gone.id, l.id)).toBeNull();

    const live = await listing(seller);
    await watch(winning, live.id).expect(200);
    await prisma.listing.update({ where: { id: live.id }, data: { highBidderId: winning.id, currentBidCents: 1000, bidCount: 1 } });
    await prisma.bid.create({ data: { listingId: live.id, bidderId: winning.id, amountCents: 1000, idempotencyKey: `k-${live.id}` } });
    await prisma.pendingEndEmail.updateMany({ where: { listingId: live.id, kind: "ENDING_SOON" }, data: { dueAt: new Date(Date.now() - 1000) } });
    const before2 = sent.length;
    await emails.sweep();
    expect(sent.slice(before2).filter((m) => m.text.includes(`/listings/${live.id}`))).toHaveLength(0);
  });

  it("lists a person's watched auctions: live first (ending soonest), then upcoming, then ended", async () => {
    const [seller, a, other] = [await makePerson(), await makePerson(), await makePerson()];
    const endsLater = await listing(seller, { endsAt: new Date(Date.now() + 5 * DAY) });
    const endsSooner = await listing(seller, { endsAt: new Date(Date.now() + 2 * DAY) });
    const upcoming = await listing(seller, { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 8 * DAY) });
    const ended = await listing(seller);
    for (const l of [endsLater, endsSooner, upcoming, ended]) await watch(a, l.id).expect(200);
    await prisma.listing.update({ where: { id: ended.id }, data: { startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() - 1000) } });
    await watch(other, endsLater.id).expect(200);
    const res = (await api().get("/watchlist").set(as(a)).expect(200)).body;
    expect(res.items.map((i: { id: string }) => i.id)).toEqual([endsSooner.id, endsLater.id, upcoming.id, ended.id]);
    expect(res.items.map((i: { phase: string }) => i.phase)).toEqual(["live", "live", "upcoming", "ended"]);
    expect(res.total).toBe(4);
    expect(res.items[0]).toMatchObject({ title: endsSooner.title, startingPriceCents: 1000, images: [] });
    expect((await api().get("/watchlist").set(as(other)).expect(200)).body.total).toBe(1);
    await api().get("/watchlist").expect(401);
  });
});

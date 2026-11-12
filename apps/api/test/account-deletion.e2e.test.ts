import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MailOutbox } from "../src/email/mail-outbox.service";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";
import { AccountDeletionService } from "../src/users/account-deletion.service";

const stamp = Date.now();
const DAY = 86_400_000;
const PASSWORD = "Password-123";
let counter = 0;

describe("deleting an account", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let service: AccountDeletionService;
  let categoryId: string;
  let passwordHash: string;
  const userIds: string[] = [];
  const listingIds: string[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];

  type Who = { id: string; email: string; username: string; auth: Record<string, string> };
  const person = async (): Promise<Who> => {
    const n = ++counter;
    const row = { id: `del_${stamp}_${n}`, email: `del-${n}-${stamp}@example.com`, firstName: "Del", lastName: "Tester", username: `de${n}x${stamp}`, passwordHash, emailVerified: new Date() };
    await prisma.user.create({ data: row });
    userIds.push(row.id);
    const token = await new SignJWT({ sv: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret());
    return { id: row.id, email: row.email, username: row.username, auth: { Authorization: `Bearer ${token}` } };
  };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 4);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    service = app.get(AccountDeletionService);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.pendingEndEmail.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.payout.deleteMany({ where: { order: { listingId: { in: listingIds } } } });
    await prisma.order.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bidAudit.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.bid.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.watch.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.strike.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const listing = async (sellerId: string, over: Record<string, unknown> = {}) => {
    const l = await prisma.listing.create({
      data: {
        sellerId, title: `Del lamp ${++counter} ${stamp}`, description: "x", categoryId, condition: "GOOD", startingPriceCents: 1000, durationDays: 3, status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 2 * DAY), publishedAt: new Date(Date.now() - DAY), ...over,
      },
    });
    listingIds.push(l.id);
    return l;
  };
  const withBid = (bidderId: string, cents = 1500) => ({ currentBidCents: cents, bidCount: 1, highBidderId: bidderId });
  const order = (listingId: string, buyerId: string, sellerId: string, over: Record<string, unknown> = {}) =>
    prisma.order.create({ data: { listingId, buyerId, sellerId, amountCents: 3000, feeCents: 150, sellerNetCents: 2850, payBy: new Date(Date.now() + DAY), ...over } });
  const kinds = async (p: Who) => ((await api().get("/me/deletion").set(p.auth).expect(200)).body.blockers as { kind: string }[]).map((b) => b.kind).sort();
  const close = async (p: Who) => {
    sent.length = 0;
    await api().post("/me/deletion/code").set(p.auth).send({ password: PASSWORD }).expect(204);
    const code = /code is (\d{6})/.exec(sent.find((m) => m.to === p.email)!.text)![1]!;
    return api().post("/me/deletion").set(p.auth).send({ password: PASSWORD, code });
  };

  it("lists what still stops the deletion: auctions with bids, auctions they are winning, undelivered purchases, unpaid-out sales", async () => {
    const [me, other] = [await person(), await person()];
    expect(await kinds(me)).toEqual([]);
    // Does not stop it: an unbid live auction, an upcoming one, a draft, a delivered purchase.
    await listing(me.id);
    await listing(me.id, { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 4 * DAY) });
    await listing(me.id, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    const delivered = await listing(other.id, { startsAt: new Date(Date.now() - 5 * DAY), endsAt: new Date(Date.now() - 2 * DAY), closedAt: new Date(Date.now() - 2 * DAY), outcome: "SOLD", winnerId: me.id, ...withBid(me.id) });
    await order(delivered.id, me.id, other.id, { status: "PAID", paidAt: new Date(), shipmentStatus: "DELIVERED", deliveredAt: new Date() });
    expect(await kinds(me)).toEqual([]);

    await listing(me.id, withBid(other.id)); // theirs, with a bid
    await listing(other.id, withBid(me.id)); // winning someone else's
    const bought = await listing(other.id, { startsAt: new Date(Date.now() - 5 * DAY), endsAt: new Date(Date.now() - 2 * DAY), closedAt: new Date(), outcome: "SOLD", winnerId: me.id, ...withBid(me.id) });
    await order(bought.id, me.id, other.id); // unpaid purchase
    const bought2 = await listing(other.id, { startsAt: new Date(Date.now() - 6 * DAY), endsAt: new Date(Date.now() - 3 * DAY), closedAt: new Date(), outcome: "SOLD", winnerId: me.id, ...withBid(me.id) });
    await order(bought2.id, me.id, other.id, { status: "PAID", paidAt: new Date(), shipmentStatus: "IN_TRANSIT" }); // paid, not delivered
    const sold = await listing(me.id, { startsAt: new Date(Date.now() - 6 * DAY), endsAt: new Date(Date.now() - 3 * DAY), closedAt: new Date(), outcome: "SOLD", winnerId: other.id, ...withBid(other.id) });
    await order(sold.id, other.id, me.id, { status: "PAID", paidAt: new Date(), shipmentStatus: "DELIVERED", deliveredAt: new Date() }); // delivered, not paid out
    expect(await kinds(me)).toEqual(["HIGH_BIDDER", "LIVE_AUCTION_WITH_BIDS", "PURCHASE_IN_PROGRESS", "PURCHASE_IN_PROGRESS", "SALE_IN_PROGRESS"]);
    await prisma.payout.create({ data: { orderId: (await prisma.order.findFirstOrThrow({ where: { listingId: sold.id } })).id, sellerId: me.id, amountCents: 2850, reference: `ref_${stamp}` } });
    expect(await kinds(me)).not.toContain("SALE_IN_PROGRESS");
  });

  it("refuses with the list, and sends no code, while something still stops it; needs the right password", async () => {
    const [me, other] = [await person(), await person()];
    await listing(me.id, withBid(other.id));
    sent.length = 0;
    await api().post("/me/deletion/code").set(me.auth).send({ password: "wrong" }).expect(403);
    const blocked = await api().post("/me/deletion/code").set(me.auth).send({ password: PASSWORD }).expect(409);
    expect(blocked.body.code).toBe("DELETION_BLOCKED");
    expect(blocked.body.blockers).toHaveLength(1);
    expect(sent).toHaveLength(0);
    await api().post("/me/deletion").set(me.auth).send({ password: PASSWORD, code: "123456" }).expect(401);
  });

  it("closes the account: ends their unbid auctions, keeps drafts, shuts them out except to look and restore, and hides their profile", async () => {
    const me = await person();
    const live = await listing(me.id);
    const upcoming = await listing(me.id, { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 4 * DAY) });
    const draft = await listing(me.id, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    await api().get(`/users/${me.username}`).expect(200);
    sent.length = 0;
    await api().post("/me/deletion/code").set(me.auth).send({ password: PASSWORD }).expect(204);
    const code = /code is (\d{6})/.exec(sent.find((m) => m.to === me.email)!.text)![1]!;
    await api().post("/me/deletion").set(me.auth).send({ password: "wrong", code }).expect(403);
    await api().post("/me/deletion").set(me.auth).send({ password: PASSWORD, code: code === "000000" ? "111111" : "000000" }).expect(401);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).toMatchObject({ deletionRequestedAt: null });

    const done = await api().post("/me/deletion").set(me.auth).send({ password: PASSWORD, code }).expect(200);
    expect(done.body.closedAt).not.toBeNull();
    expect(new Date(done.body.deletesAt).getTime() - new Date(done.body.closedAt).getTime()).toBe(30 * DAY);

    for (const id of [live.id, upcoming.id]) {
      const l = await prisma.listing.findUniqueOrThrow({ where: { id } });
      expect(l).toMatchObject({ outcome: "NO_BIDS", removedById: me.id, removalReason: "The seller closed their account." });
      expect(l.closedAt).not.toBeNull();
    }
    // Drafts are deleted at once.
    expect(await prisma.listing.count({ where: { id: draft.id } })).toBe(0);

    // Shut out of everything but looking at the deletion and restoring.
    const refused = await api().get("/me").set(me.auth).expect(403);
    expect(refused.body.code).toBe("ACCOUNT_CLOSING");
    await api().post("/listings").set(me.auth).send({}).expect(403);
    await api().get("/me/deletion").set(me.auth).expect(200);
    // Their profile is gone, and a repeat is refused.
    await api().get(`/users/${me.username}`).expect(404);
    expect((await api().post("/me/deletion").set(me.auth).send({ password: PASSWORD, code }).expect(403)).body.code).toBe("ACCOUNT_CLOSING");
  });

  it("deletes drafts at once and hands back the photo addresses nothing else uses, for the web app to delete", async () => {
    const [me, other] = [await person(), await person()];
    const draft = await listing(me.id, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    const kept = await listing(other.id);
    const own = `https://abc.public.blob.vercel-storage.com/listings/${me.id}/own-${stamp}.jpg`;
    const shared = `https://abc.public.blob.vercel-storage.com/listings/${me.id}/shared-${stamp}.jpg`;
    await prisma.listingImage.createMany({
      data: [
        { listingId: draft.id, url: own, pathname: `listings/${me.id}/own-${stamp}.jpg`, position: 0 },
        { listingId: draft.id, url: shared, pathname: `listings/${me.id}/shared-${stamp}.jpg`, position: 1 },
        { listingId: kept.id, url: shared, pathname: `listings/${me.id}/shared-${stamp}.jpg`, position: 0 },
      ],
    });
    const done = await close(me);
    expect(done.status).toBe(200);
    expect(done.body.removedImageUrls).toEqual([own]);
    expect(await prisma.listing.count({ where: { id: draft.id } })).toBe(0);
    expect(await prisma.listingImage.count({ where: { listingId: kept.id } })).toBe(1);
  });

  it("carries a deleted account's strikes over to whoever verifies the same email address again", async () => {
    const me = await person();
    await prisma.strike.createMany({ data: [1, 2].map((n) => ({ userId: me.id, listingId: `gone_${stamp}_${++counter}`, orderId: `order_${stamp}_${counter}_${n}` })) });
    expect((await close(me)).status).toBe(200);
    await prisma.user.update({ where: { id: me.id }, data: { deletionRequestedAt: new Date(Date.now() - 31 * DAY) } });
    expect(await service.sweep()).toBeGreaterThanOrEqual(1);
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(gone.emailFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(gone.emailFingerprint).not.toContain(me.email);

    // The same address signs up again: nothing moves until the address is verified.
    const username = `again${stamp}${++counter}`;
    sent.length = 0;
    await api().post("/auth/signup").send({ firstName: "Del", lastName: "Again", username, email: me.email, password: PASSWORD, confirmPassword: PASSWORD }).expect(201);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { email: me.email } });
    userIds.push(fresh.id);
    expect(await prisma.strike.count({ where: { userId: fresh.id } })).toBe(0);
    const code = /code is (\d{6})/.exec(sent.find((m) => m.to === me.email)!.text)![1]!;
    await api().post("/auth/login/verify").send({ email: me.email, code }).expect(200);
    expect(await prisma.strike.count({ where: { userId: fresh.id } })).toBe(2);
    expect(await prisma.strike.count({ where: { userId: me.id } })).toBe(0);
  });

  it("restores a closed account, but not the auctions that were ended", async () => {
    const me = await person();
    const live = await listing(me.id);
    expect((await close(me)).status).toBe(200);
    await api().get("/me").set(me.auth).expect(403);
    const restored = (await api().post("/me/deletion/restore").set(me.auth).expect(200)).body;
    expect(restored.closedAt).toBeNull();
    await api().get("/me").set(me.auth).expect(200);
    await api().get(`/users/${me.username}`).expect(200);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: live.id } })).closedAt).not.toBeNull();
    expect((await api().post("/me/deletion/restore").set(me.auth).expect(409)).body.code).toBe("NOT_CLOSED");
  });

  it("anonymises the account once the 30 days are over and not before, keeping what other people's records need", async () => {
    const [me, other] = [await person(), await person()];
    const draft = await listing(me.id, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
    const theirs = await listing(me.id, { startsAt: new Date(Date.now() - 9 * DAY), endsAt: new Date(Date.now() - 6 * DAY), closedAt: new Date(Date.now() - 6 * DAY), outcome: "NO_BIDS" });
    const others = await listing(other.id, { startsAt: new Date(Date.now() - 9 * DAY), endsAt: new Date(Date.now() - 6 * DAY), closedAt: new Date(Date.now() - 6 * DAY), outcome: "SOLD", winnerId: me.id, ...withBid(me.id) });
    await prisma.bid.create({ data: { listingId: others.id, bidderId: me.id, amountCents: 1500, idempotencyKey: randomUUID() } });
    const bought = await order(others.id, me.id, other.id, { status: "PAID", paidAt: new Date(), shipmentStatus: "DELIVERED", deliveredAt: new Date() });
    await prisma.watch.create({ data: { userId: me.id, listingId: theirs.id } });
    await prisma.user.update({ where: { id: me.id }, data: { pickupAddress: { name: "Ana", line1: "Rr. 1", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344111222" } } });
    expect((await close(me)).status).toBe(200);

    await prisma.user.update({ where: { id: me.id }, data: { deletionRequestedAt: new Date(Date.now() - 29 * DAY) } });
    expect(await service.sweep()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).deletedAt).toBeNull();

    await prisma.user.update({ where: { id: me.id }, data: { deletionRequestedAt: new Date(Date.now() - 31 * DAY) } });
    expect(await service.sweep()).toBeGreaterThanOrEqual(1);
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(gone).toMatchObject({ firstName: "Deleted", lastName: "user", passwordHash: "!deleted", emailVerified: null, pickupAddress: null, payoutAccountId: null });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.email).toBe(`deleted-${me.id}@deleted.invalid`);
    expect(gone.username).toBe(`deleted_${me.id.slice(-8)}`);
    expect(await prisma.listing.count({ where: { id: draft.id } })).toBe(0);
    expect(await prisma.watch.count({ where: { userId: me.id } })).toBe(0);
    // Kept: their bid, the order, and their ended listing.
    expect(await prisma.bid.count({ where: { bidderId: me.id } })).toBeGreaterThan(0);
    expect(await prisma.order.count({ where: { id: bought.id } })).toBe(1);
    expect(await prisma.listing.count({ where: { id: theirs.id } })).toBe(1);
    // The old session is over, the old email is free, and the account cannot be restored.
    await api().get("/me/deletion").set(me.auth).expect(401);
    expect(await prisma.user.count({ where: { email: me.email } })).toBe(0);
    expect(await service.sweep()).toBe(0);
  });

  it("lets a struck account delete itself, and refuses a banned one", async () => {
    const [struck, banned] = [await person(), await person()];
    await prisma.strike.create({ data: { userId: struck.id, listingId: `gone_${stamp}_${++counter}`, orderId: `order_${stamp}_${counter}` } });
    expect((await close(struck)).status).toBe(200);

    await prisma.user.update({ where: { id: banned.id }, data: { bannedAt: new Date(), banReason: "Fraud" } });
    expect((await api().get("/me/deletion").set(banned.auth).expect(403)).body.code).toBe("BANNED");
    expect((await api().post("/me/deletion/code").set(banned.auth).send({ password: PASSWORD }).expect(403)).body.code).toBe("BANNED");
  });

  it("sends no emails to an account that is being deleted", async () => {
    const [me, other] = [await person(), await person()];
    const l = await listing(other.id, { startsAt: new Date(Date.now() - 5 * DAY), endsAt: new Date(Date.now() - 2 * DAY), closedAt: new Date(), outcome: "SOLD", winnerId: other.id, ...withBid(other.id) });
    expect((await close(me)).status).toBe(200);
    sent.length = 0;
    await prisma.pendingEndEmail.create({ data: { userId: me.id, listingId: l.id, kind: "LOST" } });
    const outbox = app.get(MailOutbox);
    await outbox.sweep();
    await outbox.sweep(); // the first may have been a run already under way when the row was written
    expect(sent.filter((m) => m.to === me.email).map((m) => m.subject)).toEqual([]);
    expect(await prisma.pendingEndEmail.count({ where: { userId: me.id, listingId: l.id } })).toBe(0);
  });
});

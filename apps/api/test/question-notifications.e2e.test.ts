import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SOCKET_EVENTS, type NotificationList, type QuestionNotice, type UnreadEvent } from "@auction/shared";
import { SignJWT } from "jose";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { RealtimeAdapter } from "../src/realtime/realtime.adapter";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
const DAY = 86_400_000;

interface Person {
  id: string;
  email: string;
  username: string;
  token: string;
}

describe("question and answer notifications", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  let categoryId: string;
  let seller: Person;
  let counter = 0;
  const sockets: Socket[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];
  let failMail = false;

  const mail: MailSender = {
    async send(to, subject, text) {
      if (failMail) throw new Error("mail is down");
      sent.push({ to, subject, text });
    },
  };

  const makePeople = async (count: number): Promise<Person[]> => {
    const rows = Array.from({ length: count }, () => {
      const n = ++counter;
      return {
        id: `qn_${stamp}_${n}`,
        email: `qn-${n}-${stamp}@example.com`,
        firstName: "Q",
        lastName: "N",
        username: `qn${n}x${stamp}`,
        passwordHash: "!test",
        emailVerified: new Date(),
      };
    });
    await prisma.user.createMany({ data: rows });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        email: row.email,
        username: row.username,
        token: await new SignJWT({ email: row.email, role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(row.id).setExpirationTime("10m").sign(authSecret()),
      })),
    );
  };

  const makeListing = () =>
    prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: "Question notice listing",
        description: "A listing for the question notification tests.",
        categoryId,
        condition: "GOOD",
        startingPriceCents: 1000,
        durationDays: 3,
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 2 * DAY),
        publishedAt: new Date(Date.now() - DAY),
      },
    });

  const ask = (person: Person, listingId: string, body: string) => request(url).post(`/listings/${listingId}/questions`).set("Authorization", `Bearer ${person.token}`).send({ body });
  const answer = (person: Person, questionId: string, body: string) => request(url).post(`/questions/${questionId}/answer`).set("Authorization", `Bearer ${person.token}`).send({ body });
  const list = (person: Person) => request(url).get("/notifications").set("Authorization", `Bearer ${person.token}`);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

  const listen = async (person: Person) => {
    const socket = connect(url, { auth: { token: person.token }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    await settle();
    return socket;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_INDEX)
      .useValue(new NoopSearchIndex())
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new RealtimeAdapter(app));
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    [seller] = await makePeople(1);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    const mine = { email: { startsWith: "qn-", endsWith: `-${stamp}@example.com` } };
    await prisma.questionLog.deleteMany({ where: { actorId: { startsWith: `qn_${stamp}_` } } });
    await prisma.listing.deleteMany({ where: { seller: mine } });
    await prisma.user.deleteMany({ where: mine });
    await app.close();
  });

  it("tells the seller about a new question with a toast, a saved notification, the unread count and an email", async () => {
    const [anna] = await makePeople(1);
    const listing = await makeListing();
    const socket = await listen(seller);
    const notices: QuestionNotice[] = [];
    const unread: UnreadEvent[] = [];
    socket.on(SOCKET_EVENTS.questionNotice, (n: QuestionNotice) => notices.push(n));
    socket.on(SOCKET_EVENTS.unread, (e: UnreadEvent) => unread.push(e));

    const asked = await ask(anna, listing.id, "Does it still run?").expect(201);
    await settle();

    expect(notices).toEqual([{ listingId: listing.id, questionId: asked.body.id, title: "Question notice listing", from: anna.username, excerpt: "Does it still run?" }]);
    expect(unread).toHaveLength(1);
    const mine = (await list(seller).expect(200)).body as NotificationList;
    expect(mine.items[0]).toMatchObject({ type: "QUESTION_ASKED", listingId: listing.id, readAt: null });
    expect(mine.unreadCount).toBe(unread[0].unreadCount);
    const email = sent.find((m) => m.to === seller.email && m.text.includes("Does it still run?"));
    expect(email?.subject).toBe("New question on Question notice listing");
    expect(email?.text).toContain(`/listings/${listing.id}`);
    expect((await list(anna).expect(200)).body.items).toEqual([]);
  });

  it("tells the asker when the seller answers, and nobody else", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    const asked = await ask(anna, listing.id, "Is the box included?").expect(201);
    await settle();
    const annaSocket = await listen(anna);
    const benSocket = await listen(ben);
    const toAnna: QuestionNotice[] = [];
    const toBen: QuestionNotice[] = [];
    annaSocket.on(SOCKET_EVENTS.answerNotice, (n: QuestionNotice) => toAnna.push(n));
    benSocket.on(SOCKET_EVENTS.answerNotice, (n: QuestionNotice) => toBen.push(n));

    await answer(seller, asked.body.id, "Yes, with the original box.").expect(201);
    await settle();

    expect(toAnna).toEqual([{ listingId: listing.id, questionId: asked.body.id, title: "Question notice listing", from: seller.username, excerpt: "Yes, with the original box." }]);
    expect(toBen).toEqual([]);
    const mine = (await list(anna).expect(200)).body as NotificationList;
    expect(mine.items[0]).toMatchObject({ type: "QUESTION_ANSWERED", listingId: listing.id, readAt: null });
    const email = sent.find((m) => m.to === anna.email && m.text.includes("original box"));
    expect(email?.subject).toBe(`${seller.username} answered your question on Question notice listing`);
    expect((await list(ben).expect(200)).body.items).toEqual([]);
  });

  it("sends nothing for a refused question or answer", async () => {
    const [anna, ben] = await makePeople(2);
    const listing = await makeListing();
    const before = sent.length;
    const asked = await ask(anna, listing.id, "A real question").expect(201);
    await settle();
    expect(sent.length).toBe(before + 1);
    await answer(ben, asked.body.id, "I am not the seller").expect(403);
    await ask(seller, listing.id, "Asking myself").expect(403);
    await settle();
    expect(sent.length).toBe(before + 1);
    expect((await list(anna).expect(200)).body.items).toEqual([]);
  });

  it("still saves the question and the notification when the email fails", async () => {
    const [anna] = await makePeople(1);
    const listing = await makeListing();
    failMail = true;
    try {
      const asked = await ask(anna, listing.id, "Will mail fail?").expect(201);
      await settle();
      const saved = await prisma.question.findUniqueOrThrow({ where: { id: asked.body.id } });
      expect(saved.body).toBe("Will mail fail?");
      const mine = (await list(seller).expect(200)).body as NotificationList;
      expect(mine.items.some((i) => i.type === "QUESTION_ASKED" && i.listingId === listing.id)).toBe(true);
    } finally {
      failMail = false;
    }
  });
});

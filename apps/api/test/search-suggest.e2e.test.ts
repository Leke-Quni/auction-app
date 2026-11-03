import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { PostgresSearchIndex } from "../src/search/postgres-search-index";
import { SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now().toString(36);
const word = `sugg${stamp}`;
const HOUR = 3600_000;

describe("GET /search/suggest", () => {
  let app: INestApplication;
  let prisma: Prisma;
  let url: string;
  const sellerId = `sugg_${stamp}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue({ async send() {} })
      // Typesense may be configured on this machine and would not know listings written straight to the database.
      .overrideProvider(SEARCH_INDEX)
      .useFactory({ factory: (db: Prisma) => new PostgresSearchIndex(db), inject: [PRISMA] })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PRISMA);
    await prisma.user.create({ data: { id: sellerId, email: `${sellerId}@example.com`, firstName: "S", lastName: "S", username: `sg${stamp}`, passwordHash: "!test", emailVerified: new Date() } });
    const categoryId = (await prisma.category.findFirstOrThrow()).id;
    const make = (title: string, over: Record<string, unknown> = {}) =>
      prisma.listing.create({
        data: {
          sellerId,
          title,
          description: "Plain",
          categoryId,
          condition: "GOOD",
          startingPriceCents: 1000,
          durationDays: 3,
          status: "PUBLISHED",
          startsAt: new Date(Date.now() - HOUR),
          endsAt: new Date(Date.now() + 48 * HOUR),
          publishedAt: new Date(Date.now() - HOUR),
          ...over,
        },
      });
    await make(`${word} brass lamp`);
    await make(`${word} brass lamp`); // the same title twice
    await make(`${word} glass vase`);
    await make(`${word} ended clock`, { endsAt: new Date(Date.now() - HOUR) });
    await make(`${word} draft chair`, { status: "DRAFT", startsAt: null, endsAt: null, publishedAt: null });
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: sellerId } });
    await app.close();
  });

  it("suggests the titles of live listings that match the start of a word, once each, never ended or draft ones", async () => {
    const res = await request(url).get("/search/suggest").query({ q: word.slice(0, -2) }).expect(200);
    expect([...res.body.suggestions].sort()).toEqual([`${word} brass lamp`, `${word} glass vase`]);
    expect((await request(url).get("/search/suggest").query({ q: `${word} bra` }).expect(200)).body.suggestions).toEqual([`${word} brass lamp`]);
  });

  it("answers an empty list for text that matches nothing, and refuses text that is too short or missing", async () => {
    expect((await request(url).get("/search/suggest").query({ q: `nomatch${stamp}` }).expect(200)).body).toEqual({ suggestions: [] });
    await request(url).get("/search/suggest").query({ q: "a" }).expect(400);
    await request(url).get("/search/suggest").query({ q: "   " }).expect(400);
    await request(url).get("/search/suggest").expect(400);
  });
});

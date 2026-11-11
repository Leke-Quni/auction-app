import "reflect-metadata";
import { MAX_SEARCH_RESULTS, SEARCH_RATE_LIMIT, SUGGEST_RATE_LIMIT, UPLOAD_DAILY_RATE_LIMIT, UPLOAD_HOURLY_RATE_LIMIT } from "@auction/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { signViewerIp } from "../src/common/client-ip";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MemoryRateLimiter, RATE_LIMITER, type RateLimiter } from "../src/rate-limit/rate-limiter";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";
import { waitForLimiter } from "./limiter-ready";
import { UploadsController } from "../src/uploads/uploads.controller";

const stamp = Date.now();
// Counts live in Redis between runs, so every run uses addresses and users of its own.
const octet = stamp % 250;
const ipHeaders = (ip: string) => ({ "x-viewer-ip": ip, "x-viewer-ip-signature": signViewerIp(ip) });
const emptyPage = { documents: [], total: 0 };

describe("limits on search and uploads", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const index = new NoopSearchIndex();
  const search = vi.spyOn(index, "search").mockResolvedValue(emptyPage);
  const api = () => request(app.getHttpServer());
  const ids: string[] = [];

  const tokenFor = (id: string) => new SignJWT({ role: "USER" }).setProtectedHeader({ alg: "HS256" }).setSubject(id).setExpirationTime("10m").sign(authSecret());
  const makeUser = async (tag: string) => {
    const id = `lim_${stamp}_${tag}`;
    await prisma.user.create({ data: { id, email: `lim-${tag}-${stamp}@example.com`, firstName: "L", lastName: "T", username: `lim${tag}${stamp}`.slice(0, 20), passwordHash: "!test", emailVerified: new Date() } });
    ids.push(id);
    return { id, headers: { Authorization: `Bearer ${await tokenFor(id)}` } };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SEARCH_INDEX).useValue(index).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
    await waitForLimiter(app);
    await request(app.getHttpServer()).get("/search").set(ipHeaders("198.51.100.250")).expect(200);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  // Sends `count` requests, 8 at a time, and returns their statuses.
  const burst = async (count: number, send: () => Promise<{ status: number }>) => {
    const statuses: number[] = [];
    for (let sent = 0; sent < count; sent += 8) {
      statuses.push(...(await Promise.all(Array.from({ length: Math.min(8, count - sent) }, send))).map((r) => r.status));
    }
    return statuses;
  };

  describe("search", () => {
    it("answers up to the limit for one address, then 429 without doing any search, while another address is unaffected", async () => {
      const ip = `198.51.${octet}.10`;
      search.mockClear();
      const statuses = await burst(SEARCH_RATE_LIMIT.limit, () => api().get("/search?q=watch").set(ipHeaders(ip)));
      expect(statuses.every((s) => s === 200)).toBe(true);
      const over = await api().get("/search?q=watch").set(ipHeaders(ip)).expect(429);
      expect(over.body.code).toBe("RATE_LIMITED");
      expect(search).toHaveBeenCalledTimes(SEARCH_RATE_LIMIT.limit);
      await api().get("/search?q=watch").set(ipHeaders(`198.51.${octet}.11`)).expect(200);
    }, 60_000);

    it("limits suggestions on their own count", async () => {
      const ip = `198.51.${octet}.20`;
      const statuses = await burst(SUGGEST_RATE_LIMIT.limit, () => api().get("/search/suggest?q=wat").set(ipHeaders(ip)));
      expect(statuses.every((s) => s === 200)).toBe(true);
      await api().get("/search/suggest?q=wat").set(ipHeaders(ip)).expect(429);
      // The same address can still search: suggestions and searches are counted apart.
      await api().get("/search?q=watch").set(ipHeaders(ip)).expect(200);
    }, 60_000);

    it("does not let a caller pick its own address with an unsigned header", async () => {
      const victim = `198.51.${octet}.30`;
      for (let i = 0; i < 3; i++) await api().get("/search?q=a").set({ "x-viewer-ip": victim }).expect(200);
      // Nothing was counted against the address the header claimed: the first count for it is still the first.
      expect(await app.get<RateLimiter>(RATE_LIMITER).allow(`rl:search:${victim}`, 1, 60)).toBe(true);
    });

    it("refuses a page deeper than the first results, and allows the last one that fits", async () => {
      const ip = `198.51.${octet}.40`;
      for (const [page, pageSize, status] of [
        [Math.floor(MAX_SEARCH_RESULTS / 24), 24, 200],
        [Math.floor(MAX_SEARCH_RESULTS / 24) + 1, 24, 400],
        [MAX_SEARCH_RESULTS / 50, 50, 200],
        [MAX_SEARCH_RESULTS / 50 + 1, 50, 400],
        [100000, 24, 400],
        [1, 24, 200],
      ] as const) {
        const res = await api().get(`/search?page=${page}&pageSize=${pageSize}`).set(ipHeaders(ip));
        expect(res.status, `page ${page} of ${pageSize}`).toBe(status);
      }
    });
  });

  describe("photo upload permission", () => {
    it("needs a signed-in person", async () => {
      await api().post("/uploads/authorize").expect(401);
    });

    it("allows the hourly number for one person, then 429, without touching anyone else", async () => {
      const a = await makeUser("a");
      const b = await makeUser("b");
      const statuses = await burst(UPLOAD_HOURLY_RATE_LIMIT.limit, () => api().post("/uploads/authorize").set(a.headers));
      expect(statuses.every((s) => s === 204)).toBe(true);
      const over = await api().post("/uploads/authorize").set(a.headers).expect(429);
      expect(over.body.code).toBe("RATE_LIMITED");
      await api().post("/uploads/authorize").set(b.headers).expect(204);
    }, 60_000);

    it("also stops at the daily number when the hourly count keeps starting over", async () => {
      const limiter = new MemoryRateLimiter();
      const controller = new UploadsController(limiter);
      const req = { user: { id: "u1", email: "u1@example.com", role: "USER" as const, isSuperAdmin: false } };
      let allowed = 0;
      for (let i = 0; i < UPLOAD_DAILY_RATE_LIMIT.limit + 5; i++) {
        if (i % UPLOAD_HOURLY_RATE_LIMIT.limit === 0) await limiter.reset("rl:upload-hour:u1");
        try {
          await controller.authorize(req);
          allowed++;
        } catch (error) {
          expect((error as { getStatus: () => number }).getStatus()).toBe(429);
        }
      }
      expect(allowed).toBe(UPLOAD_DAILY_RATE_LIMIT.limit);
    });
  });
});

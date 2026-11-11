import "reflect-metadata";
import { MAX_SEARCH_RESULTS, SEARCH_RATE_LIMIT, SUGGEST_RATE_LIMIT } from "@auction/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { signViewerIp } from "../src/common/client-ip";
import { RATE_LIMITER, type RateLimiter } from "../src/rate-limit/rate-limiter";
import { NoopSearchIndex, SEARCH_INDEX } from "../src/search/search-index";

const stamp = Date.now();
// Counts live in Redis between runs, so every run uses addresses of its own.
const octet = stamp % 250;
const ipHeaders = (ip: string) => ({ "x-viewer-ip": ip, "x-viewer-ip-signature": signViewerIp(ip) });
const emptyPage = { documents: [], total: 0 };

describe("limits on search", () => {
  let app: INestApplication;
  const index = new NoopSearchIndex();
  const search = vi.spyOn(index, "search").mockResolvedValue(emptyPage);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SEARCH_INDEX).useValue(index).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // The limiter connects to Redis in the background and lets requests through uncounted until it has (by design), so wait for it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await request(app.getHttpServer()).get("/search").set(ipHeaders("198.51.100.250")).expect(200);
  });

  afterAll(async () => {
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

});

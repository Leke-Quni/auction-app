import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRateLimiter } from "../src/rate-limit/rate-limiter";

afterEach(() => vi.useRealTimers());

describe("MemoryRateLimiter", () => {
  it("allows up to the limit in a window, then refuses, per key", async () => {
    const limiter = new MemoryRateLimiter();
    const results = await Promise.all([1, 2, 3, 4].map(() => limiter.allow("a", 3, 60)));
    expect(results).toEqual([true, true, true, false]);
    expect(await limiter.allow("b", 3, 60)).toBe(true);
  });

  it("starts a fresh count when the window is over", async () => {
    vi.useFakeTimers();
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) await limiter.allow("a", 3, 60);
    expect(await limiter.allow("a", 3, 60)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(await limiter.allow("a", 3, 60)).toBe(true);
  });
});

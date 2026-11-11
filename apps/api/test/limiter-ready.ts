import type { INestApplication } from "@nestjs/common";
import { RATE_LIMITER, type RateLimiter } from "../src/rate-limit/rate-limiter";

// The limiter connects to Redis in the background and lets requests through uncounted until it has (by design, so a Redis outage never
// stops bidding). A test that counts attempts must start after that, or its first requests are not counted and the limit is reached late.
// Counts a throwaway key until the second count is refused, which only happens once Redis is really counting.
export async function waitForLimiter(app: INestApplication, timeoutMs = 15_000) {
  const limiter = app.get<RateLimiter>(RATE_LIMITER);
  const key = `rl:ready:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await limiter.reset(key);
    const first = await limiter.allow(key, 1, 60);
    const second = await limiter.allow(key, 1, 60);
    if (first && !second) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The rate limiter never started counting (is Redis running?)");
}

import { Logger } from "@nestjs/common";
import { createClient } from "redis";

export const RATE_LIMITER = Symbol("RATE_LIMITER");

export interface RateLimiter {
  // Counts one attempt against `key` and says whether it is within `limit` for the current `windowSeconds`.
  allow(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  // Forgets the count for `key`, for when the thing it was counting did not happen after all.
  reset(key: string): Promise<void>;
  close(): Promise<void>;
}

// For development without Redis: counts live in this process only.
export class MemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, { count: number; resetsAt: number }>();

  async allow(key: string, limit: number, windowSeconds: number) {
    const now = Date.now();
    for (const [k, v] of this.counts) if (v.resetsAt <= now) this.counts.delete(k);
    const entry = this.counts.get(key) ?? { count: 0, resetsAt: now + windowSeconds * 1000 };
    entry.count++;
    this.counts.set(key, entry);
    return entry.count <= limit;
  }

  async reset(key: string) {
    this.counts.delete(key);
  }

  async close() {}
}

// One atomic step that works on any Redis version (EXPIRE ... NX needs 7): the window starts at the first attempt.
const INCREMENT_WITH_WINDOW = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count`;

// Counts in Redis so every API machine shares one count. If Redis cannot be reached the attempt is allowed: the
// database still decides every bid, and a limiter outage must not stop bidding.
export class RedisRateLimiter implements RateLimiter {
  private readonly log = new Logger("RateLimit");
  private readonly client;

  constructor(url: string) {
    // Without this, commands wait for a lost connection to return instead of failing at once.
    this.client = createClient({ url, disableOfflineQueue: true });
    this.client.on("error", (error) => this.log.error(`Redis: ${error.message}`));
    void this.client.connect().catch(() => undefined);
  }

  async allow(key: string, limit: number, windowSeconds: number) {
    try {
      const count = (await this.client.eval(INCREMENT_WITH_WINDOW, { keys: [key], arguments: [String(windowSeconds)] })) as number;
      return count <= limit;
    } catch (error) {
      this.log.warn(`Not limiting ${key.split(":")[1]} while Redis is unavailable: ${(error as Error).message}`);
      return true;
    }
  }

  async reset(key: string) {
    await this.client.del(key).catch(() => undefined);
  }

  async close() {
    await this.client.quit().catch(() => undefined);
  }
}

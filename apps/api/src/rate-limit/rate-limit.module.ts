import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import { redisUrl } from "../config";
import { MemoryRateLimiter, RATE_LIMITER, RedisRateLimiter, type RateLimiter } from "./rate-limiter";

@Global()
@Module({
  providers: [{ provide: RATE_LIMITER, useFactory: (): RateLimiter => (redisUrl() ? new RedisRateLimiter(redisUrl()!) : new MemoryRateLimiter()) }],
  exports: [RATE_LIMITER],
})
export class RateLimitModule implements OnModuleDestroy {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  onModuleDestroy() {
    return this.limiter.close();
  }
}

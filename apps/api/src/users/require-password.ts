import { CURRENT_PASSWORD_RATE_LIMIT } from "@auction/shared";
import { ForbiddenException, HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type { Prisma } from "../db/db.module";
import type { RateLimiter } from "../rate-limit/rate-limiter";

// The current password, asked for before a change to the account. Every try is counted before the hash is compared, so simultaneous
// guesses cannot slip past the limit; the right password clears the count, so only wrong ones in a row add up.
export async function requirePassword(prisma: Prisma, limiter: RateLimiter, userId: string, password: string) {
  const key = `rl:current-password:${userId}`;
  if (!(await limiter.allow(key, CURRENT_PASSWORD_RATE_LIMIT.limit, CURRENT_PASSWORD_RATE_LIMIT.windowSeconds))) {
    throw new HttpException({ code: "RATE_LIMITED", message: "Too many wrong passwords. Wait 15 minutes and try again." }, HttpStatus.TOO_MANY_REQUESTS);
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedException();
  if (!(await bcrypt.compare(password, user.passwordHash))) throw new ForbiddenException("Incorrect password");
  await limiter.reset(key);
  return user;
}

import { SUPPORT_BANNED_RATE_LIMIT, SUPPORT_RATE_LIMIT, type SupportRequestInput, type SupportStrike, type SuspendedSupportInput } from "@auction/shared";
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";

// What a signed-in person can say to the site's admins: a question, or an appeal against one of their strikes. Admins read these
// in the admin app and answer by email.
@Injectable()
export class SupportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  // The person's own strikes, newest first, and whether each already has an appeal waiting.
  async strikes(userId: string): Promise<SupportStrike[]> {
    const strikes = await this.prisma.strike.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    const listings = await this.prisma.listing.findMany({ where: { id: { in: strikes.flatMap((s) => (s.listingId ? [s.listingId] : [])) } }, select: { id: true, title: true } });
    const open = await this.prisma.supportRequest.findMany({ where: { userId, status: "OPEN", strikeId: { in: strikes.map((s) => s.id) } }, select: { strikeId: true } });
    const titleOf = new Map(listings.map((l) => [l.id, l.title]));
    const appealed = new Set(open.map((o) => o.strikeId));
    return strikes.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      reason: s.reason,
      givenByAdmin: s.givenById !== null,
      listingTitle: s.listingId ? (titleOf.get(s.listingId) ?? null) : null,
      appealed: appealed.has(s.id),
    }));
  }

  // From the suspended page, with no sign-in (a suspended account cannot sign in). It saves a request only when the email belongs to a
  // suspended account that has none waiting, and answers the same either way, so it reveals nothing about accounts. The limit is
  // per email, whatever the account, for the same reason.
  async createBanAppeal({ email, message }: SuspendedSupportInput) {
    if (!(await this.limiter.allow(`rl:support-banned:${email}`, SUPPORT_BANNED_RATE_LIMIT.limit, SUPPORT_BANNED_RATE_LIMIT.windowSeconds))) {
      throw new HttpException({ code: "RATE_LIMITED", message: "You have sent several messages today. Wait for our answer, or try again tomorrow." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, bannedAt: { not: null } }, select: { id: true } });
    if (!user) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support:${user.id}`}))`;
      if (await tx.supportRequest.findFirst({ where: { userId: user.id, kind: "BAN_APPEAL", status: "OPEN" }, select: { id: true } })) return;
      await tx.supportRequest.create({ data: { userId: user.id, kind: "BAN_APPEAL", message } });
    });
  }

  async create(userId: string, input: SupportRequestInput) {
    if (input.kind === "STRIKE_APPEAL") {
      const strike = await this.prisma.strike.findFirst({ where: { id: input.strikeId, userId }, select: { id: true } });
      if (!strike) throw new NotFoundException({ code: "STRIKE_NOT_FOUND", message: "That strike no longer exists. It may have been cleared already." });
    }
    if (input.kind === "STRIKE_APPEAL" && (await this.prisma.supportRequest.findFirst({ where: { userId, strikeId: input.strikeId, status: "OPEN" }, select: { id: true } }))) {
      throw new ConflictException({ code: "ALREADY_APPEALED", message: "You already appealed this strike. We will answer by email." });
    }
    if (!(await this.limiter.allow(`rl:support:${userId}`, SUPPORT_RATE_LIMIT.limit, SUPPORT_RATE_LIMIT.windowSeconds))) {
      throw new HttpException({ code: "RATE_LIMITED", message: "You have sent several requests today. Wait for our answer, or try again tomorrow." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // The duplicate check and the insert share a per-person lock, so two simultaneous appeals for one strike save only one.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support:${userId}`}))`;
      if (input.kind === "STRIKE_APPEAL" && (await tx.supportRequest.findFirst({ where: { userId, strikeId: input.strikeId, status: "OPEN" }, select: { id: true } }))) {
        throw new ConflictException({ code: "ALREADY_APPEALED", message: "You already appealed this strike. We will answer by email." });
      }
      const row = await tx.supportRequest.create({
        data: { userId, kind: input.kind, strikeId: input.kind === "STRIKE_APPEAL" ? input.strikeId : null, message: input.message },
        select: { id: true },
      });
      return { id: row.id };
    });
  }
}

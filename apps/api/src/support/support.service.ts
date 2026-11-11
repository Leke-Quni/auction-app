import { SUPPORT_BANNED_IP_RATE_LIMIT, SUPPORT_BANNED_RATE_LIMIT, SUPPORT_RATE_LIMIT, type SupportRequestInput, type SupportStrike, type SuspendedSupportInput } from "@auction/shared";
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";

// One message waiting at a time (2026-11-11, owner's request): until an admin has answered (closed) the last question or strike appeal,
// the person cannot send another. A ban appeal is not counted: it is written from the suspended page, and an unban would leave it open.
const WAITING_KINDS: ("GENERAL" | "STRIKE_APPEAL")[] = ["GENERAL", "STRIKE_APPEAL"];
const WAITING = { status: "OPEN" as const, kind: { in: WAITING_KINDS } };
const waitingError = () => new ConflictException({ code: "REQUEST_WAITING", message: "You already have a message waiting for an answer. Once we have answered by email, you can write again." });

// What a signed-in person can say to the site's admins: a question, or an appeal against one of their strikes. Admins read these
// in the admin app and answer by email.
@Injectable()
export class SupportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  // Whether the person has a question or appeal that no admin has answered yet, so the form can say so before they write.
  async waiting(userId: string) {
    return { waiting: (await this.prisma.supportRequest.count({ where: { userId, ...WAITING } })) > 0 };
  }

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
  // suspended account that has none waiting, and answers the same either way, so it reveals nothing about accounts. The limits are per
  // address and per email, whatever the account, for the same reason, and every call takes the same path (a lock, a lookup) so a
  // quick answer does not give the account away either.
  async createBanAppeal({ email, message }: SuspendedSupportInput, ip: string | null) {
    const tooMany = (what: string) => new HttpException({ code: "RATE_LIMITED", message: `You have sent several ${what} today. Wait for our answer, or try again tomorrow.` }, HttpStatus.TOO_MANY_REQUESTS);
    if (ip && !(await this.limiter.allow(`rl:support-banned-ip:${ip}`, SUPPORT_BANNED_IP_RATE_LIMIT.limit, SUPPORT_BANNED_IP_RATE_LIMIT.windowSeconds))) throw tooMany("messages from this connection");
    if (!(await this.limiter.allow(`rl:support-banned:${email}`, SUPPORT_BANNED_RATE_LIMIT.limit, SUPPORT_BANNED_RATE_LIMIT.windowSeconds))) throw tooMany("messages");
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-banned:${email}`}))`;
      const user = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, bannedAt: { not: null } }, select: { id: true } });
      const waiting = user ? await tx.supportRequest.findFirst({ where: { userId: user.id, kind: "BAN_APPEAL", status: "OPEN" }, select: { id: true } }) : null;
      if (user && !waiting) await tx.supportRequest.create({ data: { userId: user.id, kind: "BAN_APPEAL", message } });
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
    if ((await this.prisma.supportRequest.count({ where: { userId, ...WAITING } })) > 0) throw waitingError();
    if (!(await this.limiter.allow(`rl:support:${userId}`, SUPPORT_RATE_LIMIT.limit, SUPPORT_RATE_LIMIT.windowSeconds))) {
      throw new HttpException({ code: "RATE_LIMITED", message: "You have sent several requests today. Wait for our answer, or try again tomorrow." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // The duplicate check and the insert share a per-person lock, so two simultaneous appeals for one strike save only one.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support:${userId}`}))`;
      if (input.kind === "STRIKE_APPEAL" && (await tx.supportRequest.findFirst({ where: { userId, strikeId: input.strikeId, status: "OPEN" }, select: { id: true } }))) {
        throw new ConflictException({ code: "ALREADY_APPEALED", message: "You already appealed this strike. We will answer by email." });
      }
      if ((await tx.supportRequest.count({ where: { userId, ...WAITING } })) > 0) throw waitingError();
      const row = await tx.supportRequest.create({
        data: { userId, kind: input.kind, strikeId: input.kind === "STRIKE_APPEAL" ? input.strikeId : null, message: input.message },
        select: { id: true },
      });
      return { id: row.id };
    });
  }
}

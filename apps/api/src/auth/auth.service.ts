import {
  FORGOT_PASSWORD_IP_RATE_LIMIT,
  FORGOT_PASSWORD_RATE_LIMIT,
  SIGN_IN_IP_RATE_LIMIT,
  SIGN_IN_RATE_LIMIT,
  SIGN_UP_IP_RATE_LIMIT,
  SIGN_UP_RATE_LIMIT,
  type ForgotPasswordInput,
  type LoginCodeInput,
  type ResetPasswordInput,
  type ResendLoginCodeInput,
  type SignInInput,
  type SignUpInput,
} from "@auction/shared";
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { loginCodeCooldownSeconds, webUrl } from "../config";
import { conflict, isUniqueViolation } from "../common/errors";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { RATE_LIMITER, type RateLimiter } from "../rate-limit/rate-limiter";

import { CODE_TTL_MS, generateCode, hashCode, MAX_CODE_ATTEMPTS, sameHash } from "./codes";

const RESET_TTL_MS = 60 * 60 * 1000;
// Compared against when the email is unknown, so unknown emails cost as much as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
// "Send a new code" works for this long after the password step, and at most this many times in one sign-in.
const RESEND_WINDOW_MS = 30 * 60_000;
const MAX_CODE_RESENDS = 5;
const loginScope = (userId: string) => `login:${userId}`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  // Counts one attempt per email and, when the visitor's address is known, per address. Runs before any password hashing or
  // lookup, so a flood costs almost nothing. Returns false when either limit is passed.
  private async withinLimits(name: string, email: string, ip: string | null, perEmail: { limit: number; windowSeconds: number }, perIp: { limit: number; windowSeconds: number }) {
    if (ip && !(await this.limiter.allow(`rl:${name}-ip:${ip}`, perIp.limit, perIp.windowSeconds))) return false;
    return this.limiter.allow(`rl:${name}:${email}`, perEmail.limit, perEmail.windowSeconds);
  }

  private tooMany() {
    return new HttpException({ code: "RATE_LIMITED", message: "Too many attempts. Wait a while and try again." }, HttpStatus.TOO_MANY_REQUESTS);
  }

  async signUp(input: SignUpInput, ip: string | null = null) {
    const email = input.email.toLowerCase();
    if (!(await this.withinLimits("signup", email, ip, SIGN_UP_RATE_LIMIT, SIGN_UP_IP_RATE_LIMIT))) throw this.tooMany();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerified) throw conflict("EMAIL_TAKEN", "Email already registered");
    const usernameHolder = await this.prisma.user.findUnique({ where: { username: input.username } });
    if (usernameHolder && usernameHolder.email !== email) throw conflict("USERNAME_TAKEN", "Username already taken");
    if (existing) await this.assertCodeCooldown(existing.id);

    try {
      // An unverified account is replaced, so nobody can block an address they don't own. This is safe
      // because every sign-in needs a code from that inbox, so knowing the password gets nobody in.
      const profile = { firstName: input.firstName, lastName: input.lastName, username: input.username, passwordHash };
      const user = existing
        ? await this.prisma.user.update({ where: { email }, data: profile })
        : await this.prisma.user.create({ data: { email, ...profile } });
      await this.sendLoginCode(user);
      return { id: user.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost a race: work out which of the two unique fields was taken.
      const taken = await this.prisma.user.findUnique({ where: { username: input.username } });
      throw taken && taken.email !== email
        ? conflict("USERNAME_TAKEN", "Username already taken")
        : conflict("EMAIL_TAKEN", "Email already registered");
    }
  }

  // Step 1 of sign-in: check the password, then email a one-time code. Sign-up sends the same code.
  async startLogin(input: SignInInput, ip: string | null = null) {
    const email = input.email.toLowerCase();
    if (!(await this.withinLimits("signin", email, ip, SIGN_IN_RATE_LIMIT, SIGN_IN_IP_RATE_LIMIT))) throw this.tooMany();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches) throw new UnauthorizedException("Invalid email or password");
    // Said only after the right password, so it tells a stranger nothing about who has an account.
    if (user.bannedAt) throw new ForbiddenException({ code: "BANNED", message: "This account has been suspended." });

    await this.assertCodeCooldown(user.id);
    await this.sendLoginCode(user);
  }

  // A short wait between codes, so nobody can use sign-in to flood an inbox. Only asked after the password is right,
  // so it tells a stranger nothing about who has an account.
  private async assertCodeCooldown(userId: string) {
    const wait = loginCodeCooldownSeconds();
    if (wait === 0) return;
    const latest = await this.prisma.loginCode.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!latest) return;
    const left = Math.ceil((latest.createdAt.getTime() + wait * 1000 - Date.now()) / 1000);
    if (left > 0) {
      throw new HttpException(
        { code: "CODE_COOLDOWN", message: `A code was just sent. Wait ${left} second${left === 1 ? "" : "s"} before asking for another.`, retryAfterSeconds: left },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // A new code for someone who is partway through signing in, who has not got the first or let it expire. There is no password
  // here, so it sends only to an account whose password step passed in the last RESEND_WINDOW, at most MAX_RESENDS times per
  // sign-in and once per cooldown, and it answers the same whether or not it sent anything: it cannot be used to find out who
  // has an account, and it can only ever write to the account's own inbox.
  async resendLoginCode(input: ResendLoginCodeInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || user.bannedAt) return;
    const latest = await this.prisma.loginCode.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!latest || latest.resends >= MAX_CODE_RESENDS || Date.now() - latest.createdAt.getTime() > RESEND_WINDOW_MS) return;
    if (Date.now() - latest.createdAt.getTime() < loginCodeCooldownSeconds() * 1000) return;
    await this.sendLoginCode(user, latest.resends + 1);
  }

  private async sendLoginCode(user: { id: string; email: string }, resends = 0) {
    const code = generateCode();
    await this.prisma.$transaction([
      this.prisma.loginCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.loginCode.create({
        data: { userId: user.id, codeHash: hashCode(loginScope(user.id), code), expiresAt: new Date(Date.now() + CODE_TTL_MS), resends },
      }),
    ]);
    await this.mail.send(user.email, "Your sign-in code", `Your sign-in code is ${code}. It expires in 10 minutes.`);
  }

  // Step 2: a correct code completes the sign-in and verifies the email.
  async verifyLoginCode(input: LoginCodeInput) {
    const invalid = () => new UnauthorizedException("Invalid or expired code");
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || user.bannedAt) throw invalid();

    const record = await this.prisma.loginCode.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!record || record.expiresAt < new Date()) throw invalid();

    // The try is counted before the code is checked, in one guarded step, so simultaneous guesses cannot all slip under the limit.
    const { count: claimed } = await this.prisma.loginCode.updateMany({
      where: { id: record.id, attempts: { lt: MAX_CODE_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed === 0 || !sameHash(hashCode(loginScope(user.id), input.code), record.codeHash)) throw invalid();

    // Deleting the code is what makes it single-use, even for simultaneous submissions.
    const { count } = await this.prisma.loginCode.deleteMany({ where: { id: record.id } });
    if (count === 0) throw invalid();

    if (!user.emailVerified) {
      await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
    }
    return { id: user.id, email: user.email, name: user.username, role: user.role };
  }

  async forgotPassword(input: ForgotPasswordInput, ip: string | null = null) {
    const email = input.email.toLowerCase();
    // Too many from one address is refused. Too many for one email is answered like success, so it does not show the email has an account.
    if (ip && !(await this.limiter.allow(`rl:forgot-ip:${ip}`, FORGOT_PASSWORD_IP_RATE_LIMIT.limit, FORGOT_PASSWORD_IP_RATE_LIMIT.windowSeconds))) throw this.tooMany();
    if (!(await this.limiter.allow(`rl:forgot:${email}`, FORGOT_PASSWORD_RATE_LIMIT.limit, FORGOT_PASSWORD_RATE_LIMIT.windowSeconds))) return;
    // The caller gets the same answer whether or not the email has an account.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = randomBytes(32).toString("hex");
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      }),
    ]);
    try {
      await this.mail.send(
        user.email,
        "Reset your password",
        `Reset your password: ${webUrl()}/reset-password?token=${token}\nThis link expires in 1 hour. If you didn't ask for it, ignore this email.`,
      );
    } catch (error) {
      // Saying the email failed would reveal that the address has an account, so the caller gets the usual answer.
      this.logger.warn(`Could not send a password reset email: ${(error as Error).message}`);
    }
  }

  async resetPassword(input: ResetPasswordInput) {
    const invalid = () => new BadRequestException("Invalid or expired link");
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!record || record.expiresAt < new Date()) throw invalid();

    // Deleting the token is what makes the link single-use, even for simultaneous submissions.
    const { count } = await this.prisma.passwordResetToken.deleteMany({ where: { id: record.id } });
    if (count === 0) throw invalid();

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    await this.prisma.$transaction([
      // Following the emailed link proves the inbox, so it also verifies the email.
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(input.password, 12), emailVerified: user.emailVerified ?? new Date() },
      }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.loginCode.deleteMany({ where: { userId: user.id } }),
    ]);
  }
}

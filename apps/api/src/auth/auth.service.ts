import type {
  ForgotPasswordInput,
  LoginCodeInput,
  ResetPasswordInput,
  SignInInput,
  SignUpInput,
} from "@auction/shared";
import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { webUrl } from "../config";
import { conflict, isUniqueViolation } from "../common/errors";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";

import { CODE_TTL_MS, generateCode, hashCode, MAX_CODE_ATTEMPTS, sameHash } from "./codes";

const RESET_TTL_MS = 60 * 60 * 1000;
// Compared against when the email is unknown, so unknown emails cost as much as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const loginScope = (userId: string) => `login:${userId}`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  async signUp(input: SignUpInput) {
    const email = input.email.toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerified) throw conflict("EMAIL_TAKEN", "Email already registered");
    const usernameHolder = await this.prisma.user.findUnique({ where: { username: input.username } });
    if (usernameHolder && usernameHolder.email !== email) throw conflict("USERNAME_TAKEN", "Username already taken");

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
  async startLogin(input: SignInInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches) throw new UnauthorizedException("Invalid email or password");

    await this.sendLoginCode(user);
  }

  private async sendLoginCode(user: { id: string; email: string }) {
    const code = generateCode();
    await this.prisma.$transaction([
      this.prisma.loginCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.loginCode.create({
        data: { userId: user.id, codeHash: hashCode(loginScope(user.id), code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
      }),
    ]);
    await this.mail.send(user.email, "Your sign-in code", `Your sign-in code is ${code}. It expires in 10 minutes.`);
  }

  // Step 2: a correct code completes the sign-in and verifies the email.
  async verifyLoginCode(input: LoginCodeInput) {
    const invalid = () => new UnauthorizedException("Invalid or expired code");
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user) throw invalid();

    const record = await this.prisma.loginCode.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!record || record.expiresAt < new Date() || record.attempts >= MAX_CODE_ATTEMPTS) throw invalid();

    if (!sameHash(hashCode(loginScope(user.id), input.code), record.codeHash)) {
      await this.prisma.loginCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw invalid();
    }

    // Deleting the code is what makes it single-use, even for simultaneous submissions.
    const { count } = await this.prisma.loginCode.deleteMany({ where: { id: record.id } });
    if (count === 0) throw invalid();

    if (!user.emailVerified) {
      await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
    }
    return { id: user.id, email: user.email, name: user.username, role: user.role };
  }

  async forgotPassword(input: ForgotPasswordInput) {
    // The caller gets the same answer whether or not the email has an account.
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
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

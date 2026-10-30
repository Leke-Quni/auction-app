import type { SignInInput, SignUpInput } from "@auction/shared";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
// Compared against when the email is unknown, so unknown emails cost as much as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  async signUp(input: SignUpInput) {
    const email = input.email.toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerified) throw new ConflictException("Email already registered");

    try {
      // An unverified account is replaced, so a lost or expired link is recovered by signing up again.
      const user = existing
        ? await this.prisma.user.update({ where: { email }, data: { name: input.name, passwordHash } })
        : await this.prisma.user.create({ data: { email, name: input.name, passwordHash } });
      await this.sendVerification(user.email);
      return { id: user.id };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new ConflictException("Email already registered");
      throw error;
    }
  }

  async verifyEmail(token: string) {
    const record = await this.prisma.verificationToken.findUnique({ where: { token: hashToken(token) } });
    if (!record || record.expires < new Date()) throw new BadRequestException("Invalid or expired token");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { email: record.identifier }, data: { emailVerified: new Date() } }),
      this.prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } }),
    ]);
  }

  async validateCredentials(input: SignInInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches) throw new UnauthorizedException("Invalid email or password");
    if (!user.emailVerified) throw new ForbiddenException("EMAIL_NOT_VERIFIED");
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }

  private async sendVerification(email: string) {
    const token = randomBytes(32).toString("hex");
    await this.prisma.$transaction([
      this.prisma.verificationToken.deleteMany({ where: { identifier: email } }),
      this.prisma.verificationToken.create({
        data: { identifier: email, token: hashToken(token), expires: new Date(Date.now() + VERIFY_TTL_MS) },
      }),
    ]);
    await this.mail.send(
      email,
      "Verify your email",
      `Confirm your email: ${webUrl()}/verify-email?token=${token}`,
    );
  }
}

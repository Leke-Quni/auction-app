import type {
  ChangePasswordInput,
  ConfirmEmailChangeInput,
  StartEmailChangeInput,
  UpdateProfileInput,
  UpdateUsernameInput,
} from "@auction/shared";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { conflict, isUniqueViolation } from "../common/errors";
import { CODE_TTL_MS, generateCode, hashCode, MAX_CODE_ATTEMPTS, sameHash } from "../auth/codes";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";

const emailChangeScope = (userId: string, newEmail: string) => `email-change:${userId}:${newEmail}`;

@Injectable()
export class AccountService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  async updateProfile(userId: string, input: UpdateProfileInput) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { firstName: input.firstName, lastName: input.lastName },
      select: { firstName: true, lastName: true },
    });
  }

  async updateUsername(userId: string, input: UpdateUsernameInput) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { username: input.username },
        select: { username: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("USERNAME_TAKEN", "Username already taken");
      throw error;
    }
  }

  async changePassword(userId: string, input: ChangePasswordInput) {
    await this.requirePassword(userId, input.currentPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(input.newPassword, 12) },
      }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
    ]);
  }

  async startEmailChange(userId: string, input: StartEmailChangeInput) {
    const user = await this.requirePassword(userId, input.password);
    const newEmail = input.newEmail.toLowerCase();
    if (newEmail === user.email) throw new BadRequestException("That is already your email");
    if (await this.prisma.user.findUnique({ where: { email: newEmail } })) {
      throw conflict("EMAIL_TAKEN", "Email already registered");
    }

    const code = generateCode();
    const data = {
      newEmail,
      codeHash: hashCode(emailChangeScope(userId, newEmail), code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      attempts: 0,
    };
    await this.prisma.emailChange.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await this.mail.send(newEmail, "Confirm your new email", `Your confirmation code is ${code}. It expires in 10 minutes.`);
  }

  async confirmEmailChange(userId: string, input: ConfirmEmailChangeInput) {
    const invalid = () => new UnauthorizedException("Invalid or expired code");
    const record = await this.prisma.emailChange.findUnique({ where: { userId } });
    if (!record || record.expiresAt < new Date() || record.attempts >= MAX_CODE_ATTEMPTS) throw invalid();

    if (!sameHash(hashCode(emailChangeScope(userId, record.newEmail), input.code), record.codeHash)) {
      await this.prisma.emailChange.update({ where: { userId }, data: { attempts: { increment: 1 } } });
      throw invalid();
    }

    const { count } = await this.prisma.emailChange.deleteMany({ where: { userId } });
    if (count === 0) throw invalid();

    try {
      // The code went to the new address, so it counts as verified.
      await this.prisma.user.update({ where: { id: userId }, data: { email: record.newEmail, emailVerified: new Date() } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw conflict("EMAIL_TAKEN", "Email already registered");
      throw error;
    }
    return { email: record.newEmail };
  }

  private async requirePassword(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new ForbiddenException("Incorrect password");
    return user;
  }
}

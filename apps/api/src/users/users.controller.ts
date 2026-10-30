import {
  changePasswordSchema,
  confirmEmailChangeSchema,
  startEmailChangeSchema,
  updateProfileSchema,
  updateUsernameSchema,
  type ChangePasswordInput,
  type ConfirmEmailChangeInput,
  type StartEmailChangeInput,
  type UpdateProfileInput,
  type UpdateUsernameInput,
} from "@auction/shared";
import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PRISMA, type Prisma } from "../db/db.module";
import { AccountService } from "./account.service";

type AuthedRequest = { user: AuthUser };

@Controller("me")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly account: AccountService,
  ) {}

  @Get()
  async me(@Req() req: AuthedRequest) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, firstName: true, lastName: true, username: true, role: true, emailVerified: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @Patch()
  updateProfile(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput) {
    return this.account.updateProfile(req.user.id, body);
  }

  @Patch("username")
  updateUsername(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(updateUsernameSchema)) body: UpdateUsernameInput) {
    return this.account.updateUsername(req.user.id, body);
  }

  @Post("password")
  @HttpCode(204)
  async changePassword(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    await this.account.changePassword(req.user.id, body);
  }

  @Post("email/start")
  @HttpCode(204)
  async startEmailChange(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(startEmailChangeSchema)) body: StartEmailChangeInput,
  ) {
    await this.account.startEmailChange(req.user.id, body);
  }

  @Post("email/confirm")
  @HttpCode(200)
  confirmEmailChange(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(confirmEmailChangeSchema)) body: ConfirmEmailChangeInput,
  ) {
    return this.account.confirmEmailChange(req.user.id, body);
  }
}

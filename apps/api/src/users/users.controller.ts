import {
  changePasswordSchema,
  pickupAddressSchema,
  confirmAccountDeletionSchema,
  confirmEmailChangeSchema,
  startAccountDeletionSchema,
  startEmailChangeSchema,
  updateProfileSchema,
  updateUsernameSchema,
  type ChangePasswordInput,
  type ConfirmAccountDeletionInput,
  type ConfirmEmailChangeInput,
  type StartAccountDeletionInput,
  type PickupAddress,
  type StartEmailChangeInput,
  type UpdateProfileInput,
  type UpdateUsernameInput,
} from "@auction/shared";
import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Put, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AllowClosing, JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PRISMA, type Prisma } from "../db/db.module";
import { AccountDeletionService } from "./account-deletion.service";
import { AccountService } from "./account.service";

type AuthedRequest = { user: AuthUser };

@Controller("me")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly account: AccountService,
    private readonly deletion: AccountDeletionService,
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

  // The seller's default pickup address and contact, offered when they create a listing. Null until they save one.
  @Get("pickup-address")
  async pickupAddress(@Req() req: AuthedRequest) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id }, select: { pickupAddress: true } });
    if (!user) throw new UnauthorizedException();
    return { pickupAddress: user.pickupAddress };
  }

  @Put("pickup-address")
  async savePickupAddress(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(pickupAddressSchema)) body: PickupAddress) {
    const user = await this.prisma.user.update({ where: { id: req.user.id }, data: { pickupAddress: body }, select: { pickupAddress: true } });
    return { pickupAddress: user.pickupAddress };
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
  @HttpCode(200)
  changePassword(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    return this.account.changePassword(req.user.id, body);
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

  // Deleting the account: what still stops it, asking for the confirmation code, confirming (which closes the account), and
  // restoring a closed account. Only looking and restoring work once the account is closed.
  @Get("deletion")
  @AllowClosing()
  deletionStatus(@Req() req: AuthedRequest) {
    return this.deletion.status(req.user.id);
  }

  @Post("deletion/code")
  @HttpCode(204)
  async sendDeletionCode(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(startAccountDeletionSchema)) body: StartAccountDeletionInput) {
    await this.deletion.sendCode(req.user.id, body);
  }

  @Post("deletion")
  @HttpCode(200)
  confirmDeletion(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(confirmAccountDeletionSchema)) body: ConfirmAccountDeletionInput) {
    return this.deletion.confirm(req.user.id, body);
  }

  @Post("deletion/restore")
  @HttpCode(200)
  @AllowClosing()
  restoreAccount(@Req() req: AuthedRequest) {
    return this.deletion.restore(req.user.id);
  }
}

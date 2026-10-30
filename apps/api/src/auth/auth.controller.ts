import {
  forgotPasswordSchema,
  loginCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type ForgotPasswordInput,
  type LoginCodeInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
} from "@auction/shared";
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("signup")
  signUp(@Body(new ZodValidationPipe(signUpSchema)) body: SignUpInput) {
    return this.auth.signUp(body);
  }

  @Post("login/start")
  @HttpCode(204)
  async startLogin(@Body(new ZodValidationPipe(signInSchema)) body: SignInInput) {
    await this.auth.startLogin(body);
  }

  @Post("login/verify")
  @HttpCode(200)
  verifyLoginCode(@Body(new ZodValidationPipe(loginCodeSchema)) body: LoginCodeInput) {
    return this.auth.verifyLoginCode(body);
  }

  @Post("forgot-password")
  @HttpCode(204)
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    await this.auth.forgotPassword(body);
  }

  @Post("reset-password")
  @HttpCode(204)
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    await this.auth.resetPassword(body);
  }
}

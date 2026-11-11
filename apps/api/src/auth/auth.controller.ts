import {
  forgotPasswordSchema,
  loginCodeSchema,
  resendLoginCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type ForgotPasswordInput,
  type LoginCodeInput,
  type ResendLoginCodeInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
} from "@auction/shared";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { signedClientIp } from "../common/client-ip";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // The address is used only when the web server vouched for it (signed): a guess at the connection's own would be the web server's, shared by everyone.
  @Post("signup")
  signUp(@Req() req: Parameters<typeof signedClientIp>[0], @Body(new ZodValidationPipe(signUpSchema)) body: SignUpInput) {
    return this.auth.signUp(body, signedClientIp(req));
  }

  @Post("login/start")
  @HttpCode(204)
  async startLogin(@Req() req: Parameters<typeof signedClientIp>[0], @Body(new ZodValidationPipe(signInSchema)) body: SignInInput) {
    await this.auth.startLogin(body, signedClientIp(req));
  }

  @Post("login/verify")
  @HttpCode(200)
  verifyLoginCode(@Body(new ZodValidationPipe(loginCodeSchema)) body: LoginCodeInput) {
    return this.auth.verifyLoginCode(body);
  }

  // "Send a new code" on the code page. Always answers 204, whether or not anything was sent (see AuthService.resendLoginCode).
  @Post("login/resend")
  @HttpCode(204)
  async resendLoginCode(@Body(new ZodValidationPipe(resendLoginCodeSchema)) body: ResendLoginCodeInput) {
    await this.auth.resendLoginCode(body);
  }

  @Post("forgot-password")
  @HttpCode(204)
  async forgotPassword(@Req() req: Parameters<typeof signedClientIp>[0], @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    await this.auth.forgotPassword(body, signedClientIp(req));
  }

  @Post("reset-password")
  @HttpCode(204)
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    await this.auth.resetPassword(body);
  }
}

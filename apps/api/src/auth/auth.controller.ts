import { signInSchema, signUpSchema, type SignInInput, type SignUpInput } from "@auction/shared";
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

const verifyEmailSchema = z.object({ token: z.string().min(1) });

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("signup")
  signUp(@Body(new ZodValidationPipe(signUpSchema)) body: SignUpInput) {
    return this.auth.signUp(body);
  }

  @Post("verify-email")
  @HttpCode(204)
  async verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
  }

  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(signInSchema)) body: SignInInput) {
    return this.auth.validateCredentials(body);
  }
}

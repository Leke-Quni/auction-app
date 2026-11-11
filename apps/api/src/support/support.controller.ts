import { supportRequestSchema, type SupportRequestInput } from "@auction/shared";
import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SupportService } from "./support.service";

@Controller("support")
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // The caller's own strikes, for the appeal form.
  @Get("strikes")
  strikes(@Req() req: { user: AuthUser }) {
    return this.support.strikes(req.user.id);
  }

  // Whether the caller still has a message waiting for an answer (they cannot send another until it is answered).
  @Get("waiting")
  waiting(@Req() req: { user: AuthUser }) {
    return this.support.waiting(req.user.id);
  }

  @Post()
  create(@Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(supportRequestSchema)) body: SupportRequestInput) {
    return this.support.create(req.user.id, body);
  }
}

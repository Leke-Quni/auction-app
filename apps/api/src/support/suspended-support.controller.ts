import { suspendedSupportSchema, type SuspendedSupportInput } from "@auction/shared";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { clientIp } from "../common/client-ip";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SupportService } from "./support.service";

// No sign-in: a suspended account cannot get one. It always answers 204 for a valid body, so it cannot be used to find out who is suspended.
@Controller("support/suspended")
export class SuspendedSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @HttpCode(204)
  async create(@Req() req: Parameters<typeof clientIp>[0], @Body(new ZodValidationPipe(suspendedSupportSchema)) body: SuspendedSupportInput) {
    await this.support.createBanAppeal(body, clientIp(req));
  }
}

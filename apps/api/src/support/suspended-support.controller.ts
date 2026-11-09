import { suspendedSupportSchema, type SuspendedSupportInput } from "@auction/shared";
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SupportService } from "./support.service";

// No sign-in: a suspended account cannot get one. It always answers 204 for a valid body, so it cannot be used to find out who is suspended.
@Controller("support/suspended")
export class SuspendedSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @HttpCode(204)
  async create(@Body(new ZodValidationPipe(suspendedSupportSchema)) body: SuspendedSupportInput) {
    await this.support.createBanAppeal(body);
  }
}

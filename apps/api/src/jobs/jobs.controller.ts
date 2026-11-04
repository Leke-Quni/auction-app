import { Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { QStashSignatureGuard } from "./qstash-signature.guard";

// Called by QStash at the moment an auction ends or an order's payment window runs out.
@Controller("jobs")
@UseGuards(QStashSignatureGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post("close/:id")
  @HttpCode(200)
  close(@Param("id") id: string) {
    return this.jobs.runClose(id);
  }

  @Post("expire-order/:id")
  @HttpCode(200)
  expireOrder(@Param("id") id: string) {
    return this.jobs.runExpireOrder(id);
  }
}

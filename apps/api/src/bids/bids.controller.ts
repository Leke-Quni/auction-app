import { placeBidSchema, type PlaceBidInput } from "@auction/shared";
import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { clientIp } from "../common/client-ip";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { BidsService } from "./bids.service";

const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

@Controller()
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  // 201 for a new bid, 200 when the same bid key had already placed it.
  @Post("listings/:id/bids")
  @UseGuards(JwtAuthGuard)
  async place(
    @Param("id") id: string,
    @Req() req: { user: AuthUser; ip?: string; headers: Record<string, string | string[] | undefined> },
    @Body(new ZodValidationPipe(placeBidSchema)) body: PlaceBidInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.bids.placeBid(req.user.id, id, body, clientIp(req));
    if (result.replayed) res.status(200);
    return result;
  }

  @Get("listings/:id/bids")
  history(@Param("id") id: string, @Query(new ZodValidationPipe(historyQuerySchema)) query: z.infer<typeof historyQuerySchema>) {
    return this.bids.history(id, query.limit);
  }
}

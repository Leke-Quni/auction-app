import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminGuard, JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { AdminReportsService } from "./admin-reports.service";

const reportsQuerySchema = z.object({ status: z.enum(["OPEN", "HANDLED"]).default("OPEN"), limit: z.coerce.number().int().min(1).max(200).default(100) });
const logQuerySchema = z.object({
  questionId: z.string().min(1).optional(),
  listingId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// Everything under /admin needs a signed-in account that is an ADMIN in the database right now (see AdminGuard); the admin app
// never decides that for itself.
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly reports: AdminReportsService) {}

  // Who the admin app is talking to. It also tells the admin app whether a signed-in person may use it at all.
  @Get("me")
  me(@Req() req: { user: AuthUser }) {
    return { id: req.user.id, email: req.user.email, role: req.user.role };
  }

  // The reports queue: open ones oldest first, handled ones newest first, with how many are open in all.
  @Get("reports")
  listReports(@Query(new ZodValidationPipe(reportsQuerySchema)) query: z.infer<typeof reportsQuerySchema>) {
    return this.reports.listReports(query);
  }

  @Post("reports/:id/handle")
  @HttpCode(200)
  handleReport(@Param("id") id: string) {
    return this.reports.handleReport(id);
  }

  // Every post, edit and deletion of questions and answers, newest first, optionally for one question, listing or person.
  @Get("question-log")
  questionLog(@Query(new ZodValidationPipe(logQuerySchema)) query: z.infer<typeof logQuerySchema>) {
    return this.reports.questionLog(query);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminGuard, JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { AdminListingsService } from "./admin-listings.service";
import { AdminOrdersService } from "./admin-orders.service";
import { AdminReportsService } from "./admin-reports.service";
import { AdminUsersService } from "./admin-users.service";

const reportsQuerySchema = z.object({ status: z.enum(["OPEN", "HANDLED"]).default("OPEN"), limit: z.coerce.number().int().min(1).max(200).default(100) });
const usersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  banned: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ordersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["AWAITING_PAYMENT", "PAID", "EXPIRED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const banSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const removeListingSchema = z.object({ reason: z.string().trim().min(1).max(500) });
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
  constructor(
    private readonly reports: AdminReportsService,
    private readonly listings: AdminListingsService,
    private readonly users: AdminUsersService,
    private readonly orders: AdminOrdersService,
  ) {}

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

  @Get("listings/:id")
  getListing(@Param("id") id: string) {
    return this.listings.get(id);
  }

  // Takes a live or upcoming auction down: it ends now with no sale and the reason is kept with the listing.
  @Post("listings/:id/remove")
  @HttpCode(200)
  removeListing(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(removeListingSchema)) body: z.infer<typeof removeListingSchema>) {
    return this.listings.remove(req.user.id, id, body.reason);
  }

  @Get("users")
  listUsers(@Query(new ZodValidationPipe(usersQuerySchema)) query: z.infer<typeof usersQuerySchema>) {
    return this.users.list(query);
  }

  @Get("users/:id")
  getUser(@Param("id") id: string) {
    return this.users.get(id);
  }

  // Suspends the account: every request is refused from now on, and any page they have open is told and disconnected.
  @Post("users/:id/ban")
  @HttpCode(200)
  banUser(@Param("id") id: string, @Body(new ZodValidationPipe(banSchema)) body: z.infer<typeof banSchema>) {
    return this.users.ban(id, body.reason);
  }

  @Post("users/:id/unban")
  @HttpCode(200)
  unbanUser(@Param("id") id: string) {
    return this.users.unban(id);
  }

  // Removes one strike, so a person at the limit can bid again.
  @Delete("strikes/:id")
  clearStrike(@Param("id") id: string) {
    return this.users.clearStrike(id);
  }

  @Get("orders")
  listOrders(@Query(new ZodValidationPipe(ordersQuerySchema)) query: z.infer<typeof ordersQuerySchema>) {
    return this.orders.list(query);
  }

  // The whole order with both addresses: the buyer's delivery address and phone, the seller's pickup address, the amounts
  // each side sees, the parcel and the payout. Read only.
  @Get("orders/:id")
  getOrder(@Param("id") id: string) {
    return this.orders.get(id);
  }
}

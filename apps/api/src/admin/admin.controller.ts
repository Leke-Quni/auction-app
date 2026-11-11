import { ORDER_ATTENTION_KINDS, ORDER_NOTE_MAX, ORDER_RESEND_KINDS } from "@auction/shared";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminGuard, JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { AdminAuditService } from "./admin-audit.service";
import { AdminListingsService } from "./admin-listings.service";
import { AdminSupportService } from "./admin-support.service";
import { AdminOverviewService } from "./admin-overview.service";
import { AdminOrdersService } from "./admin-orders.service";
import { AdminReportsService } from "./admin-reports.service";
import { AdminUsersService } from "./admin-users.service";

const supportQuerySchema = z.object({ status: z.enum(["OPEN", "HANDLED"]).default("OPEN"), limit: z.coerce.number().int().min(1).max(200).default(100) });
const reportsQuerySchema = z.object({ status: z.enum(["OPEN", "HANDLED"]).default("OPEN"), limit: z.coerce.number().int().min(1).max(200).default(100) });
const usersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  banned: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ordersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["AWAITING_PAYMENT", "PAID", "EXPIRED", "CANCELLED"]).optional(),
  attention: z.enum([...ORDER_ATTENTION_KINDS, "any"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const orderNoteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(ORDER_NOTE_MAX) });
const resendSchema = z.object({ kind: z.enum(ORDER_RESEND_KINDS) });
const invoiceQuerySchema = z.object({ party: z.enum(["buyer", "seller"]) });
const roleSchema = z.object({ role: z.enum(["USER", "ADMIN"]) });
const strikeSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const banSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const removeListingSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const auditQuerySchema = z.object({ adminId: z.string().min(1).optional(), targetId: z.string().min(1).optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
const listingsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  phase: z.enum(["upcoming", "live", "ended", "removed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const removeQuestionPostSchema = z.object({ target: z.enum(["QUESTION", "ANSWER"]), version: z.string().max(64).optional() });
const logQuerySchema = z.object({
  questionId: z.string().min(1).optional(),
  listingId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  q: z.string().trim().max(100).optional(),
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
    private readonly audit: AdminAuditService,
    private readonly overview: AdminOverviewService,
    private readonly support: AdminSupportService,
  ) {}

  // Who the admin app is talking to. It also tells the admin app whether a signed-in person may use it at all.
  @Get("me")
  me(@Req() req: { user: AuthUser }) {
    return { id: req.user.id, email: req.user.email, role: req.user.role, isSuperAdmin: req.user.isSuperAdmin };
  }

  // Counts for the Overview page and the sidebar badge.
  @Get("overview")
  getOverview() {
    return this.overview.get();
  }

  // What people sent through the support form: appeals against strikes and general questions.
  @Get("support")
  listSupport(@Query(new ZodValidationPipe(supportQuerySchema)) query: z.infer<typeof supportQuerySchema>) {
    return this.support.list(query);
  }

  @Post("support/:id/handle")
  @HttpCode(200)
  handleSupport(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.support.handle(req.user.id, id);
  }

  // Grants a strike appeal: clears the strike and closes the request in one transaction.
  @Post("support/:id/grant")
  @HttpCode(200)
  grantAppeal(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.support.grantAppeal(req.user.id, id);
  }

  // Grants a ban appeal: lifts the ban and closes the request in one transaction.
  @Post("support/:id/lift-ban")
  @HttpCode(200)
  liftBan(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.support.liftBan(req.user.id, id);
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

  // Deletes the reported question or answer and closes the reports about it.
  @Post("reports/:id/remove-post")
  @HttpCode(200)
  removePost(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.reports.removePost(req.user.id, id);
  }

  // Takes a question or an answer down straight from the question log, with no report needed.
  @Post("questions/:id/remove")
  @HttpCode(200)
  removeQuestionPost(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(removeQuestionPostSchema)) body: z.infer<typeof removeQuestionPostSchema>) {
    return this.reports.removeQuestionPost(req.user.id, id, body.target, body.version);
  }

  // Every post, edit and deletion of questions and answers, newest first, optionally for one question, listing or person.
  @Get("question-log")
  questionLog(@Query(new ZodValidationPipe(logQuerySchema)) query: z.infer<typeof logQuerySchema>) {
    return this.reports.questionLog(query);
  }

  @Get("listings")
  listListings(@Query(new ZodValidationPipe(listingsQuerySchema)) query: z.infer<typeof listingsQuerySchema>) {
    return this.listings.list(query);
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
  banUser(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(banSchema)) body: z.infer<typeof banSchema>) {
    return this.users.ban(req.user.id, id, body.reason);
  }

  @Post("users/:id/unban")
  @HttpCode(200)
  unbanUser(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.users.unban(req.user.id, id);
  }

  // Gives the account a strike with a reason (two block bidding).
  @Post("users/:id/strike")
  @HttpCode(200)
  strikeUser(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(strikeSchema)) body: z.infer<typeof strikeSchema>) {
    return this.users.strike(req.user.id, id, body.reason);
  }

  // Strikes whoever wrote the reported question or answer, and closes every open report about that post.
  @Post("reports/:id/strike-author")
  @HttpCode(200)
  strikeAuthor(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.reports.strikeAuthor(req.user.id, id);
  }

  // Makes an account an admin, or an ordinary user again.
  @Post("users/:id/role")
  @HttpCode(200)
  setRole(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(roleSchema)) body: z.infer<typeof roleSchema>) {
    return this.users.setRole(req.user.id, req.user.isSuperAdmin, id, body.role);
  }

  // Removes one strike, so a person at the limit can bid again.
  @Delete("strikes/:id")
  clearStrike(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.users.clearStrike(req.user.id, id);
  }

  @Get("orders")
  listOrders(@Query(new ZodValidationPipe(ordersQuerySchema)) query: z.infer<typeof ordersQuerySchema>) {
    return this.orders.list(query);
  }

  // The whole order with both addresses: the buyer's delivery address and phone, the seller's pickup address, the amounts
  // each side sees, the parcel and the payout. Read only.
  @Get("orders/:id")
  getOrder(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.orders.get(id, req.user.id);
  }

  // A private note on an order, for the admins who look at it next. The buyer and the seller never see it.
  @Post("orders/:id/notes")
  addOrderNote(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(orderNoteSchema)) body: z.infer<typeof orderNoteSchema>) {
    return this.orders.addNote(req.user.id, id, body.body);
  }

  // Sends one of the order's emails again (see `AdminOrdersService.resendEmail` for which, and the 10 minute wait).
  @Post("orders/:id/resend")
  @HttpCode(200)
  resendOrderEmail(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(resendSchema)) body: z.infer<typeof resendSchema>) {
    return this.orders.resendEmail(req.user.id, id, body.kind);
  }

  // The paid order's invoice as its buyer sees it (`party=buyer`) or the sale statement its seller sees (`party=seller`), as a PDF.
  @Get("orders/:id/invoice")
  async orderInvoice(@Param("id") id: string, @Req() req: { user: AuthUser }, @Query(new ZodValidationPipe(invoiceQuerySchema)) query: z.infer<typeof invoiceQuerySchema>) {
    const { filename, pdf } = await this.orders.invoice(req.user.id, id, query.party);
    return new StreamableFile(pdf, { type: "application/pdf", disposition: `attachment; filename="${filename}"` });
  }

  // What admins did, newest first, optionally one admin's actions or those aimed at one user, listing or order.
  @Get("audit")
  auditLog(@Query(new ZodValidationPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>) {
    return this.audit.list(query);
  }
}

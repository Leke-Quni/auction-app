import { Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { OrdersService } from "./orders.service";

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Req() req: { user: AuthUser }, @Query("listingId") listingId?: string) {
    return this.orders.list(req.user.id, listingId);
  }

  @Get(":id")
  get(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.orders.get(req.user.id, id);
  }

  @Post(":id/checkout")
  checkout(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.orders.checkout(req.user.id, id);
  }

  @Post(":id/confirm")
  confirm(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.orders.confirm(req.user.id, id);
  }

  @Post(":id/test-pay")
  testPay(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.orders.simulatePayment(req.user.id, id);
  }
}

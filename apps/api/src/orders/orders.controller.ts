import { saveShippingSchema } from "@auction/shared";
import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { OrdersService } from "./orders.service";

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Req() req: { user: AuthUser }, @Query("listingId") listingId?: unknown) {
    if (listingId !== undefined && typeof listingId !== "string") throw new BadRequestException("listingId must be a single value");
    return this.orders.list(req.user.id, listingId);
  }

  @Get(":id")
  get(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.orders.get(req.user.id, id);
  }

  @Get(":id/shipping/options")
  shippingOptions(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    return this.orders.shippingOptions(req.user.id, id);
  }

  @Put(":id/shipping")
  setShipping(@Req() req: { user: AuthUser }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = saveShippingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.orders.setShipping(req.user.id, id, parsed.data);
  }

  @Get(":id/invoice")
  async invoice(@Req() req: { user: AuthUser }, @Param("id") id: string) {
    const { filename, pdf } = await this.orders.invoice(req.user.id, id);
    return new StreamableFile(pdf, { type: "application/pdf", disposition: `attachment; filename="${filename}"` });
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

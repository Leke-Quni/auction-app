import { BadRequestException, Controller, Headers, HttpCode, Inject, Logger, NotFoundException, Post, Req } from "@nestjs/common";
import type Stripe from "stripe";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider";
import { StripePaymentProvider } from "../payments/stripe-payment-provider";
import { OrdersService } from "./orders.service";

// Stripe calls this when a payment goes through, so an order is marked paid even if the buyer closes the tab before
// coming back to us. It has no sign-in: the signature on the raw body is the proof. A repeated event changes nothing; a
// payment that does not match the order is refunded (see OrdersService.settlePayment).
@Controller("payments/stripe")
export class StripeWebhookController {
  private readonly log = new Logger(StripeWebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    private readonly orders: OrdersService,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: { rawBody?: Buffer }, @Headers("stripe-signature") signature?: string) {
    if (!(this.payments instanceof StripePaymentProvider)) throw new NotFoundException();
    if (!signature || !req.rawBody) throw new BadRequestException("Missing signature or body");
    let event: Stripe.Event;
    try {
      event = this.payments.parseWebhook(req.rawBody, signature);
    } catch {
      throw new BadRequestException("Invalid signature");
    }
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;
      const orderId = session.client_reference_id ?? session.metadata?.orderId;
      if (session.payment_status === "paid" && orderId) {
        // Throws if a refund that is owed fails, which answers the webhook with an error so Stripe sends it again.
        await this.orders.settlePayment(orderId, session.id, session.amount_total, session.currency);
      }
    }
    return { received: true };
  }
}

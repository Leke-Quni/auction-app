import { ORDER_REFUSAL_MESSAGES, deliveryOptions, type RateSellerInput, type OrderRefusal, type OrderView, type SaveShippingInput, type ShippingAddress, type ShippingOption } from "@auction/shared";
import { deliveryRule } from "../config";
import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { FakePaymentProvider } from "../payments/fake-payment-provider";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider";
import { SHIPPING_PROVIDER, type ShippingProvider } from "../shipping/shipping-provider";
import { deliveryOf, invoiceDataOf, renderInvoice } from "./invoice";
import { queueMail } from "../email/mail-outbox";
import { notificationKey } from "../notifications/notification-keys";
import { payoutViewOf } from "./payout-view";

const STATUS: Record<OrderRefusal, HttpStatus> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  NOT_BUYER: HttpStatus.FORBIDDEN,
  NOT_PAYABLE: HttpStatus.CONFLICT,
  PAYMENT_WINDOW_CLOSED: HttpStatus.CONFLICT,
  SHIPPING_REQUIRED: HttpStatus.CONFLICT,
  SHIPPING_OPTION_UNAVAILABLE: HttpStatus.CONFLICT,
  NOT_PAID: HttpStatus.CONFLICT,
  NOT_SELLER: HttpStatus.FORBIDDEN,
  ALREADY_SHIPPED: HttpStatus.CONFLICT,
  NOT_DELIVERED: HttpStatus.CONFLICT,
  ALREADY_RATED: HttpStatus.CONFLICT,
};
const refuse = (code: OrderRefusal) => new HttpException({ code, message: ORDER_REFUSAL_MESSAGES[code] }, STATUS[code]);

// Test payments exist only on a machine that says it is local or a test run; an unnamed or unknown environment (staging,
// preview) is treated as real.
const testPaymentsAllowed = () => [undefined, "development", "test"].includes(process.env.NODE_ENV);

const include = {
  listing: { select: { title: true } },
  buyer: { select: { id: true, username: true, email: true } },
  seller: { select: { id: true, username: true, payoutAccountId: true } },
  payout: true,
  rating: true,
} as const;

@Injectable()
export class OrdersService {
  private readonly log = new Logger(OrdersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(SHIPPING_PROVIDER) private readonly carrier: ShippingProvider,
  ) {}

  // Only the buyer and the seller can see an order; anyone else is told it does not exist.
  async get(userId: string, orderId: string): Promise<OrderView> {
    return this.view(userId, await this.find(userId, orderId));
  }

  async list(userId: string, listingId?: string): Promise<OrderView[]> {
    const rows = await this.prisma.order.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }], ...(listingId ? { listingId } : {}) },
      orderBy: [{ round: "desc" }, { createdAt: "desc" }],
      take: 100,
      include,
    });
    return rows.map((row) => this.view(userId, row));
  }

  // Starts a payment: the buyer is sent to the provider's checkout. An order has one open checkout at a time: asking again
  // (a second tab, a double click, a retry) sends the buyer to the page that is already open, so they cannot pay twice.
  // The order row is locked while this runs, so two calls at the same moment cannot each open a page.
  async checkout(userId: string, orderId: string): Promise<{ url: string }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        const order = await this.find(userId, orderId, tx);
        if (order.buyerId !== userId) throw refuse("NOT_BUYER");
        if (order.status !== "AWAITING_PAYMENT") throw refuse("NOT_PAYABLE");
        if (order.payBy.getTime() <= Date.now()) throw refuse("PAYMENT_WINDOW_CLOSED");
        const delivery = deliveryOf(order);
        if (!delivery || order.shippingCents === null || order.totalCents === null) throw refuse("SHIPPING_REQUIRED");
        if (order.paymentRef) {
          const open = await this.payments.findOpenCheckout(order.paymentRef);
          if (open && open.amountCents === order.totalCents) return { url: open.url };
          if (open) await this.payments.expireCheckout(order.paymentRef); // open, but for a total that is out of date
        }
        const session = await this.payments.createCheckout({
          orderId,
          amountCents: order.amountCents,
          shippingCents: order.shippingCents,
          shippingLabel: `Delivery: ${delivery.name}`,
          description: order.listing.title,
          buyerEmail: order.buyer.email,
        });
        await tx.order.update({ where: { id: orderId }, data: { paymentRef: session.id, paymentRefs: { push: session.id } } });
        return { url: session.url };
      },
      { timeout: 20_000 },
    );
  }

  // Asks the provider whether any attempt to pay was paid, and settles each paid one (see `settlePayment`). Safe to call any
  // number of times.
  async confirm(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.find(userId, orderId);
    if (order.buyerId !== userId) throw refuse("NOT_BUYER");
    if (order.status !== "PAID") await this.settleIfPaid(orderId);
    return this.get(userId, orderId);
  }

  // Looks at every checkout session of the order and settles any that was paid. True when the order ends up paid by one.
  // The expiry uses it too, so a payment taken but not yet reported (the buyer closed the tab, the webhook is late) is found
  // before the order is given up on and the buyer is struck.
  async settleIfPaid(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, paymentRef: true, paymentRefs: true } });
    if (!order) return false;
    if (order.status === "PAID") return true;
    const refs = [...new Set([...(order.paymentRef ? [order.paymentRef] : []), ...order.paymentRefs])].reverse();
    for (const ref of refs) {
      const result = await this.payments.confirm(ref);
      if (!result.paid) continue;
      const outcome = await this.settlePayment(orderId, ref, result.amountCents ?? null, "eur");
      if (outcome === "paid" || outcome === "already") return true;
    }
    return false;
  }

  // A payment the provider reports as taken (from the buyer coming back, or from the webhook, possibly both at once).
  // - It pays the order if the order is still waiting, the session is one of its attempts and the amount is its total.
  // - If it is a repeat of the payment that already paid the order, nothing changes.
  // - Any other payment for one of the order's sessions is money taken for nothing (a second tab, an old total, an order
  //   that expired meanwhile), so it is refunded. A refund that fails throws, so the webhook is answered with an error and
  //   the provider tries again.
  // Once the order is paid, its other sessions are closed or, if paid too, refunded: the buyer is charged exactly once.
  async settlePayment(orderId: string, sessionId: string, amountCents: number | null, currency: string | null): Promise<"paid" | "already" | "refunded" | "ignored"> {
    if (await this.markPaid(orderId, sessionId, amountCents, currency)) {
      await this.closeOtherSessions(orderId, sessionId);
      return "paid";
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, paymentRef: true, paymentRefs: true } });
    if (!order || !order.paymentRefs.includes(sessionId)) {
      this.log.warn(`Payment ${sessionId} does not belong to order ${orderId}; left alone`);
      return "ignored";
    }
    if (order.status === "PAID" && order.paymentRef === sessionId) return "already";
    await this.payments.refund(sessionId);
    this.log.warn(`Refunded payment ${sessionId} for order ${orderId} (order is ${order.status}; it did not match)`);
    return "refunded";
  }

  // After an order is paid: its other checkout sessions can no longer be paid, and one that was paid anyway is refunded.
  private async closeOtherSessions(orderId: string, paidSessionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { paymentRefs: true } });
    for (const ref of new Set(order?.paymentRefs ?? [])) {
      if (ref === paidSessionId) continue;
      try {
        if ((await this.payments.confirm(ref)).paid) await this.payments.refund(ref);
        else await this.payments.expireCheckout(ref);
      } catch (error) {
        // The webhook for that session refunds it when it arrives; this only makes it quicker.
        this.log.error(`Could not close session ${ref} of paid order ${orderId}: ${(error as Error).message}`);
      }
    }
  }

  private async markPaid(orderId: string, sessionId: string, amountCents: number | null, currency: string | null): Promise<boolean> {
    if (amountCents === null || currency?.toLowerCase() !== "eur") return false;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: {
          id: orderId,
          status: "AWAITING_PAYMENT",
          totalCents: amountCents,
          OR: [{ paymentRef: sessionId }, { paymentRefs: { has: sessionId } }],
        },
        data: { status: "PAID", paidAt: new Date(), paymentRef: sessionId },
      });
      if (result.count === 0) return false;
      // Only the call that really changed the order gets here, so the invoice number is taken, and the two emails are
      // owed, exactly once however the payment is reported (return from checkout, webhook, or both at once).
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('"InvoiceNumberSeq"') AS n`;
      const order = await tx.order.update({
        where: { id: orderId },
        data: { invoiceNumber: `INV-${new Date().getUTCFullYear()}-${String(n).padStart(6, "0")}` },
        select: { buyerId: true, sellerId: true, listingId: true },
      });
      // The "pay now" notice has done its job.
      await tx.notification.deleteMany({ where: { userId: order.buyerId, key: notificationKey.won(order.listingId) } });
      await queueMail(tx, { userId: order.buyerId, listingId: order.listingId, kind: "PAID" });
      await queueMail(tx, { userId: order.sellerId, listingId: order.listingId, kind: "SOLD" });
      return true;
    });
  }

  // The delivery options with their prices for this order: 5% of the item (within limits) plus each option's extra.
  async shippingOptions(userId: string, orderId: string): Promise<ShippingOption[]> {
    const order = await this.payableByBuyer(userId, orderId);
    return deliveryOptions(order.amountCents, deliveryRule());
  }

  // Saves the address and the chosen option. The price is worked out here, so the browser's word is never taken for it.
  // If the total changed, any checkout page already open was for the old total, so it is closed: the buyer is sent to a fresh one.
  async setShipping(userId: string, orderId: string, input: SaveShippingInput): Promise<OrderView> {
    const refs = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await this.find(userId, orderId, tx);
      if (order.buyerId !== userId) throw refuse("NOT_BUYER");
      if (order.status !== "AWAITING_PAYMENT") throw refuse("NOT_PAYABLE");
      if (order.payBy.getTime() <= Date.now()) throw refuse("PAYMENT_WINDOW_CLOSED");
      const option = deliveryOptions(order.amountCents, deliveryRule()).find((o) => o.id === input.optionId);
      if (!option) throw refuse("SHIPPING_OPTION_UNAVAILABLE");
      const totalCents = order.amountCents + option.priceCents;
      await tx.order.update({
        where: { id: orderId },
        data: { shippingAddress: input.address, shippingOption: { ...option }, shippingCents: option.priceCents, totalCents, trackingEmails: input.trackingEmails },
      });
      // Saving the same delivery again (a second tab, a retry) changes nothing the payment page shows, so an open page stays.
      return order.totalCents === totalCents ? [] : order.paymentRefs;
    });
    for (const ref of refs) {
      try {
        await this.payments.expireCheckout(ref);
      } catch (error) {
        this.log.error(`Could not close session ${ref} of order ${orderId}: ${(error as Error).message}`);
      }
    }
    return this.get(userId, orderId);
  }

  // The seller hands a paid order to the carrier: the carrier creates the label, the order is marked LABEL_CREATED and the
  // buyer is owed a "shipped" email. The update only matches a paid order that has not been shipped, so a double click or a
  // second tab changes nothing twice (the second answers ALREADY_SHIPPED).
  async ship(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.find(userId, orderId);
    if (order.sellerId !== userId) throw refuse("NOT_SELLER");
    if (order.status !== "PAID") throw refuse("NOT_PAID");
    if (order.shipmentStatus) throw refuse("ALREADY_SHIPPED");
    const delivery = deliveryOf(order);
    if (!delivery) throw refuse("NOT_PAID");
    const label = await this.carrier.createLabel({ orderId, pickup: (order.pickupAddress as ShippingAddress | null) ?? null, delivery: delivery.address as ShippingAddress, optionId: delivery.optionId });
    const marked = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: "PAID", shipmentStatus: null },
        data: { shipmentStatus: "LABEL_CREATED", trackingCode: label.trackingCode, shippedAt: new Date() },
      });
      if (result.count === 0) return false;
      if (order.trackingEmails) {
        await queueMail(tx, { userId: order.buyerId, listingId: order.listingId, kind: "SHIPPED" });
      }
      return true;
    });
    if (!marked) throw refuse("ALREADY_SHIPPED");
    return this.get(userId, orderId);
  }

  // The buyer rates the seller, once per order, after the parcel was delivered. The unique order id makes a double click or two
  // tabs rate once (the second answers ALREADY_RATED); a rating cannot be changed afterwards.
  async rate(userId: string, orderId: string, input: RateSellerInput): Promise<OrderView> {
    const order = await this.find(userId, orderId);
    if (order.buyerId !== userId) throw refuse("NOT_BUYER");
    if (order.status !== "PAID" || order.shipmentStatus !== "DELIVERED") throw refuse("NOT_DELIVERED");
    if (order.rating) throw refuse("ALREADY_RATED");
    const saved = await this.prisma.rating.createMany({
      data: { orderId, buyerId: userId, sellerId: order.sellerId, stars: input.stars, comment: input.comment ?? null },
      skipDuplicates: true,
    });
    if (saved.count === 0) throw refuse("ALREADY_RATED");
    return this.get(userId, orderId);
  }

  // The invoice as a PDF, for the buyer or the seller of a paid order.
  async invoice(userId: string, orderId: string): Promise<{ filename: string; pdf: Buffer }> {
    const order = await this.find(userId, orderId);
    const data = invoiceDataOf(order, order.buyerId === userId ? "buyer" : "seller");
    if (!data) throw refuse("NOT_PAID");
    return { filename: `${data.invoiceNumber}.pdf`, pdf: await renderInvoice(data) };
  }

  private async payableByBuyer(userId: string, orderId: string) {
    const order = await this.find(userId, orderId);
    if (order.buyerId !== userId) throw refuse("NOT_BUYER");
    if (order.status !== "AWAITING_PAYMENT") throw refuse("NOT_PAYABLE");
    if (order.payBy.getTime() <= Date.now()) throw refuse("PAYMENT_WINDOW_CLOSED");
    return order;
  }

  // For the in-memory provider only: stands in for the buyer's card going through at the provider's checkout.
  async simulatePayment(userId: string, orderId: string): Promise<{ ok: true }> {
    const order = await this.find(userId, orderId);
    if (order.buyerId !== userId) throw refuse("NOT_BUYER");
    if (!testPaymentsAllowed() || !(this.payments instanceof FakePaymentProvider) || !order.paymentRef) throw refuse("NOT_FOUND");
    if (!this.payments.simulatePayment(order.paymentRef)) throw refuse("NOT_FOUND");
    return { ok: true };
  }

  private async find(userId: string, orderId: string, db: Pick<Prisma, "order"> = this.prisma) {
    const order = await db.order.findUnique({ where: { id: orderId }, include });
    if (!order || (order.buyerId !== userId && order.sellerId !== userId)) throw refuse("NOT_FOUND");
    return order;
  }

  private view(userId: string, order: Awaited<ReturnType<OrdersService["find"]>>): OrderView {
    const seller = order.sellerId === userId;
    return {
      id: order.id,
      listingId: order.listingId,
      title: order.listing.title,
      status: order.status,
      amountCents: order.amountCents,
      payBy: order.payBy.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      viewer: seller ? "seller" : "buyer",
      buyer: { id: order.buyer.id, username: order.buyer.username },
      seller: order.seller,
      shipping: this.shippingFor(order, seller),
      totalCents: seller ? null : order.totalCents, // what the buyer paid in all is the buyer's business
      invoiceNumber: order.invoiceNumber,
      rating: order.rating ? { stars: order.rating.stars, comment: order.rating.comment, createdAt: order.rating.createdAt.toISOString() } : null,
      ...(seller ? {} : { trackingEmails: order.trackingEmails }),
      shipment: order.shipmentStatus && order.trackingCode && order.shippedAt
        ? { status: order.shipmentStatus, trackingCode: order.trackingCode, shippedAt: order.shippedAt.toISOString(), inTransitAt: order.inTransitAt?.toISOString() ?? null, deliveredAt: order.deliveredAt?.toISOString() ?? null }
        : null,
      ...(seller && order.pickupAddress ? { pickupAddress: order.pickupAddress as ShippingAddress } : {}),
      ...(seller ? { feeCents: order.feeCents, sellerNetCents: order.sellerNetCents } : {}),
      ...(seller && order.status === "PAID" ? { payout: payoutViewOf(order) } : {}),
    };
  }

  // The buyer sees the whole delivery address and its price; the seller only the city and country, as our carrier handles the delivery.
  private shippingFor(order: { shippingAddress: unknown; shippingOption: unknown }, seller: boolean): OrderView["shipping"] {
    const delivery = deliveryOf(order);
    if (!delivery || !seller) return delivery;
    // No delivery price either: that is what the buyer paid, not what the seller sold for.
    const { optionId, name, estimatedDays, tracked, insured } = delivery;
    return { optionId, name, estimatedDays, tracked, insured, address: { city: delivery.address.city, country: delivery.address.country } };
  }
}

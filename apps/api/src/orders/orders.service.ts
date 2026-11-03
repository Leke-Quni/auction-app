import { ORDER_REFUSAL_MESSAGES, type OrderRefusal, type OrderView } from "@auction/shared";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { FakePaymentProvider } from "../payments/fake-payment-provider";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider";

const STATUS: Record<OrderRefusal, HttpStatus> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  NOT_BUYER: HttpStatus.FORBIDDEN,
  NOT_PAYABLE: HttpStatus.CONFLICT,
  PAYMENT_WINDOW_CLOSED: HttpStatus.CONFLICT,
};
const refuse = (code: OrderRefusal) => new HttpException({ code, message: ORDER_REFUSAL_MESSAGES[code] }, STATUS[code]);

const include = {
  listing: { select: { title: true } },
  buyer: { select: { id: true, username: true, email: true } },
  seller: { select: { id: true, username: true } },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  // Only the buyer and the seller can see an order; anyone else is told it does not exist.
  async get(userId: string, orderId: string): Promise<OrderView> {
    return this.view(userId, await this.find(userId, orderId));
  }

  async list(userId: string, listingId?: string): Promise<OrderView[]> {
    const rows = await this.prisma.order.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }], ...(listingId ? { listingId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include,
    });
    return rows.map((row) => this.view(userId, row));
  }

  // Starts a payment: the buyer is sent to the provider's checkout. Each call starts a fresh attempt.
  async checkout(userId: string, orderId: string): Promise<{ url: string }> {
    const order = await this.find(userId, orderId);
    if (order.buyerId !== userId) throw refuse("NOT_BUYER");
    if (order.status !== "AWAITING_PAYMENT") throw refuse("NOT_PAYABLE");
    if (order.payBy.getTime() <= Date.now()) throw refuse("PAYMENT_WINDOW_CLOSED");
    const session = await this.payments.createCheckout({
      orderId,
      amountCents: order.amountCents,
      description: order.listing.title,
      buyerEmail: order.buyer.email,
    });
    await this.prisma.order.update({ where: { id: orderId }, data: { paymentRef: session.id } });
    return { url: session.url };
  }

  // Asks the provider whether the latest attempt was paid, and marks the order paid if so. Safe to call any number of
  // times: the order changes once, and a second call only reads.
  async confirm(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.find(userId, orderId);
    if (order.buyerId !== userId) throw refuse("NOT_BUYER");
    if (order.status === "AWAITING_PAYMENT" && order.paymentRef && (await this.payments.confirm(order.paymentRef)).paid) {
      await this.prisma.order.updateMany({ where: { id: orderId, status: "AWAITING_PAYMENT" }, data: { status: "PAID", paidAt: new Date() } });
    }
    return this.get(userId, orderId);
  }

  // For the in-memory provider only: stands in for the buyer's card going through at the provider's checkout.
  async simulatePayment(userId: string, orderId: string): Promise<{ ok: true }> {
    const order = await this.find(userId, orderId);
    if (order.buyerId !== userId) throw refuse("NOT_BUYER");
    if (process.env.NODE_ENV === "production" || !(this.payments instanceof FakePaymentProvider) || !order.paymentRef) throw refuse("NOT_FOUND");
    if (!this.payments.simulatePayment(order.paymentRef)) throw refuse("NOT_FOUND");
    return { ok: true };
  }

  private async find(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include });
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
      ...(seller ? { feeCents: order.feeCents, sellerNetCents: order.sellerNetCents } : {}),
    };
  }
}

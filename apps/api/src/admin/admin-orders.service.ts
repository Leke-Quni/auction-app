import { ORDER_NOTE_MAX, type OrderAttentionKind, type ShippingAddress } from "@auction/shared";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { deliveryOf, invoiceDataOf, renderInvoice } from "../orders/invoice";
import { payoutViewOf } from "../orders/payout-view";
import { attentionOf, attentionWhere } from "./admin-order-attention";

export interface OrderListQuery {
  q?: string;
  status?: "AWAITING_PAYMENT" | "PAID" | "EXPIRED" | "CANCELLED";
  // Only orders that are stuck in one way (see `attentionWhere`), or in any way.
  attention?: OrderAttentionKind | "any";
  limit: number;
}

const person = { select: { id: true, username: true, email: true, firstName: true, lastName: true } } as const;

// The admin app's read of an order: everything the buyer and the seller each see, and the parts neither is allowed to see
// of the other, in one place, so a dispute or a lost parcel can be looked into. It only reads; it changes nothing.
@Injectable()
export class AdminOrdersService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async list({ q, status, attention, limit }: OrderListQuery) {
    const now = new Date();
    const term = q?.trim();
    const like = { contains: term ?? "", mode: "insensitive" } as const;
    const orders = await this.prisma.order.findMany({
      // Each condition is its own entry, because the search text and the "any kind" filter are both an OR and must not replace each other.
      where: {
        AND: [
          ...(status ? [{ status }] : []),
          ...(attention ? [attentionWhere(attention, now)] : []),
          ...(term
            ? [{ OR: [{ id: term }, { listingId: term }, { invoiceNumber: like }, { listing: { title: like } }, { buyer: { OR: [{ username: like }, { email: like }] } }, { seller: { OR: [{ username: like }, { email: like }] } }] }]
            : []),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      include: { listing: { select: { id: true, title: true } }, buyer: { select: { id: true, username: true } }, seller: { select: { id: true, username: true } }, payout: { select: { id: true } } },
    });
    const noteCounts = new Map(
      (await this.prisma.orderNote.groupBy({ by: ["orderId"], where: { orderId: { in: orders.map((o) => o.id) } }, _count: { _all: true } })).map((n) => [n.orderId, n._count._all]),
    );
    return {
      orders: orders.map((o) => ({
        id: o.id,
        noteCount: noteCounts.get(o.id) ?? 0,
        status: o.status,
        round: o.round,
        listing: o.listing,
        buyer: o.buyer,
        seller: o.seller,
        amountCents: o.amountCents,
        totalCents: o.totalCents,
        invoiceNumber: o.invoiceNumber,
        shipmentStatus: o.shipmentStatus,
        createdAt: o.createdAt.toISOString(),
        payBy: o.payBy.toISOString(),
        paidAt: o.paidAt?.toISOString() ?? null,
        attention: attentionOf(o, now),
      })),
    };
  }

  // The invoice a paid order's buyer gets ("Invoice"), or the sale statement its seller gets, as the same PDF they download. It has the
  // delivery address and the amounts, so each look is written to the audit record like opening the order.
  async invoice(adminId: string, id: string, party: "buyer" | "seller"): Promise<{ filename: string; pdf: Buffer }> {
    const o = await this.prisma.order.findUnique({ where: { id }, include: { listing: { select: { title: true } }, buyer: { select: { username: true } }, seller: { select: { username: true } } } });
    if (!o) throw new NotFoundException();
    const data = invoiceDataOf(o, party);
    if (!data) throw new ConflictException({ code: "NOT_PAID", message: "This order has no invoice yet: it is not paid, or its delivery details are missing." });
    // A double click or a browser prefetch fetches the same file twice; one audit row per admin, order and party per minute.
    const recent = await this.prisma.adminAction.findFirst({ where: { adminId, action: "VIEW_INVOICE", targetId: id, reason: party, createdAt: { gte: new Date(Date.now() - 60_000) } }, select: { id: true } });
    if (!recent) await this.prisma.adminAction.create({ data: { adminId, action: "VIEW_INVOICE", targetId: id, reason: party } });
    return { filename: `${party === "buyer" ? "" : "statement-"}${data.invoiceNumber}.pdf`, pdf: await renderInvoice(data) };
  }

  // A private note for the admins who look at this order next, oldest first on the order page. It is saved together with its audit row,
  // never changed or deleted, and never sent to the buyer or the seller.
  async addNote(adminId: string, orderId: string, body: string) {
    if (body.length > ORDER_NOTE_MAX) throw new ConflictException({ code: "NOTE_TOO_LONG", message: `A note is at most ${ORDER_NOTE_MAX} characters.` });
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.order.findUnique({ where: { id: orderId }, select: { id: true } }))) throw new NotFoundException();
      const note = await tx.orderNote.create({ data: { orderId, adminId, body } });
      await tx.adminAction.create({ data: { adminId, action: "ADD_ORDER_NOTE", targetId: orderId, reason: note.id } });
      return { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() };
    });
  }

  private async notesOf(orderId: string) {
    const notes = await this.prisma.orderNote.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const admins = await this.prisma.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.adminId))] } }, select: { id: true, username: true } });
    const nameOf = new Map(admins.map((a) => [a.id, a.username]));
    return notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString(), admin: { id: n.adminId, username: nameOf.get(n.adminId) ?? null } }));
  }

  // Opening an order shows both addresses, so each time one is opened it is written to the audit record.
  async get(id: string, adminId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: { listing: { select: { id: true, title: true } }, buyer: person, seller: { select: { ...person.select, payoutAccountId: true } }, payout: true, rating: true },
    });
    if (!o) throw new NotFoundException();
    await this.prisma.adminAction.create({ data: { adminId, action: "VIEW_ORDER", targetId: id } });
    const delivery = deliveryOf(o);
    const who = (u: { id: string; username: string; email: string; firstName: string; lastName: string }) => ({ id: u.id, username: u.username, email: u.email, name: `${u.firstName} ${u.lastName}` });
    const notes = await this.notesOf(id);
    return {
      id: o.id,
      notes,
      status: o.status,
      round: o.round,
      listing: o.listing,
      buyer: who(o.buyer),
      seller: { ...who(o.seller), hasPayoutAccount: o.seller.payoutAccountId !== null },
      amounts: { itemCents: o.amountCents, feeCents: o.feeCents, sellerNetCents: o.sellerNetCents, shippingCents: o.shippingCents, totalCents: o.totalCents },
      createdAt: o.createdAt.toISOString(),
      payBy: o.payBy.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      reminderSentAt: o.payReminderSentAt?.toISOString() ?? null,
      invoiceNumber: o.invoiceNumber,
      // The provider's checkout sessions, to look a payment up on their side.
      paymentRef: o.paymentRef,
      paymentAttempts: o.paymentRefs.length,
      delivery: delivery ? { address: delivery.address, option: { id: delivery.optionId, name: delivery.name, estimatedDays: delivery.estimatedDays, tracked: delivery.tracked, insured: delivery.insured, priceCents: delivery.priceCents }, trackingEmails: o.trackingEmails } : null,
      pickupAddress: (o.pickupAddress as ShippingAddress | null) ?? null,
      shipment: o.shipmentStatus ? { status: o.shipmentStatus, trackingCode: o.trackingCode, shippedAt: o.shippedAt?.toISOString() ?? null, inTransitAt: o.inTransitAt?.toISOString() ?? null, deliveredAt: o.deliveredAt?.toISOString() ?? null } : null,
      payout: o.status === "PAID" ? { ...payoutViewOf(o), reference: o.payout?.reference ?? null } : null,
      rating: o.rating ? { stars: o.rating.stars, comment: o.rating.comment, createdAt: o.rating.createdAt.toISOString() } : null,
    };
  }
}

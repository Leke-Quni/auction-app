import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PRISMA, type Prisma } from "../db/db.module";
import { queueMail } from "../email/mail-outbox";
import { SHIPPING_PROVIDER, type ShippingProvider } from "../shipping/shipping-provider";

const SWEEP_EVERY_MS = 30_000;
const SWEEP_BATCH = 100;

// Asks the carrier where each shipped parcel is and moves the order on: label created -> in transit -> delivered. Each move
// is one guarded update that only matches the status the order had when it was read, so duplicate runs and several machines
// change nothing twice, and the buyer's email for it is queued in the same transaction (the leased email sweep sends it).
@Injectable()
export class ShipmentProgressService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ShipmentProgressService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(SHIPPING_PROVIDER) private readonly carrier: ShippingProvider,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Returns the new status if this call moved the order, or null if it did nothing.
  async advance(orderId: string): Promise<"IN_TRANSIT" | "DELIVERED" | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shipmentStatus: true, trackingCode: true, shippedAt: true, buyerId: true, listingId: true, trackingEmails: true },
    });
    if (!order || !order.shipmentStatus || order.shipmentStatus === "DELIVERED" || !order.trackingCode || !order.shippedAt) return null;
    const reported = await this.carrier.track({ trackingCode: order.trackingCode, shippedAt: order.shippedAt });
    // A parcel only moves forward; a carrier reporting the same or an earlier status changes nothing.
    if (reported === "LABEL_CREATED" || (reported === "IN_TRANSIT" && order.shipmentStatus === "IN_TRANSIT")) return null;
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: orderId, shipmentStatus: order.shipmentStatus },
        data: reported === "DELIVERED" ? { shipmentStatus: "DELIVERED", deliveredAt: now, ...(order.shipmentStatus === "LABEL_CREATED" ? { inTransitAt: now } : {}) } : { shipmentStatus: "IN_TRANSIT", inTransitAt: now },
      });
      if (moved.count === 0) return null;
      // A parcel that went straight to delivered (the machine was stopped) gets the delivered email only.
      // Only a buyer who asked for tracking emails gets them.
      if (order.trackingEmails) {
        await queueMail(tx, { userId: order.buyerId, listingId: order.listingId, kind: reported });
      }
      return reported;
    });
  }

  // Moves on every shipped parcel the carrier says has moved. Safe to run on every machine.
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let moved = 0;
    try {
      const open = await this.prisma.order.findMany({
        where: { shipmentStatus: { in: ["LABEL_CREATED", "IN_TRANSIT"] } },
        orderBy: { shippedAt: "asc" },
        take: SWEEP_BATCH,
        select: { id: true },
      });
      for (const { id } of open) {
        try {
          if (await this.advance(id)) moved++;
        } catch (error) {
          this.log.error(`Could not update the shipment of order ${id}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.log.error(`Shipment sweep failed: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
    return moved;
  }
}

import type { ShipmentStatus } from "@auction/shared";
import { randomBytes } from "node:crypto";
import { fakeCarrierTimes } from "../config";
import type { ShippingProvider } from "./shipping-provider";

// Moves a parcel `label created -> in transit -> delivered` on a timer counted from the label. It keeps no state, so a
// stopped API machine loses nothing: the status is worked out from the time on every call.
export class FakeShippingProvider implements ShippingProvider {
  async createLabel() {
    return { trackingCode: `FAKE${randomBytes(5).toString("hex").toUpperCase()}` };
  }

  async track({ shippedAt }: { trackingCode: string; shippedAt: Date }): Promise<ShipmentStatus> {
    const { inTransitAfterSeconds, deliveredAfterSeconds } = fakeCarrierTimes();
    const elapsed = Date.now() - shippedAt.getTime();
    if (elapsed >= deliveredAfterSeconds * 1000) return "DELIVERED";
    if (elapsed >= inTransitAfterSeconds * 1000) return "IN_TRANSIT";
    return "LABEL_CREATED";
  }
}

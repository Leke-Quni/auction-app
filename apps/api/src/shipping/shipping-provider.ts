import type { ShipmentStatus, ShippingAddress } from "@auction/shared";

export const SHIPPING_PROVIDER = Symbol("SHIPPING_PROVIDER");

export interface LabelRequest {
  orderId: string;
  // Where the carrier collects the item (null for an order that has none saved) and where it delivers.
  pickup: ShippingAddress | null;
  delivery: ShippingAddress;
  optionId: string;
}

// Everything the app needs from a carrier, so the fake one can be swapped for a real one. Delivery prices are not quoted by
// it: they are ours (see the delivery options in `packages/shared`).
export interface ShippingProvider {
  // Creates the shipment and its label; the parcel is then LABEL_CREATED.
  createLabel(request: LabelRequest): Promise<{ trackingCode: string }>;
  // Where the parcel is now. `shippedAt` is when the label was created. Safe to call any number of times; it only moves forward.
  track(request: { trackingCode: string; shippedAt: Date }): Promise<ShipmentStatus>;
}

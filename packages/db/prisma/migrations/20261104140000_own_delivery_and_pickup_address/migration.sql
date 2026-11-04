-- Delivery is now priced by the platform (a percentage plus the chosen option), and the carrier collects from a full
-- pickup address, so the city and country columns give way to one address.
ALTER TABLE "Listing" DROP COLUMN "shipFromCountry", DROP COLUMN "shipFromCity", ADD COLUMN "pickupAddress" JSONB;
ALTER TABLE "User" ADD COLUMN "pickupAddress" JSONB;
ALTER TABLE "Order" ADD COLUMN "pickupAddress" JSONB;

-- Delivery chosen under the old quotes (a different option shape and price) must be chosen again.
UPDATE "Order" SET "shippingAddress" = NULL, "shippingOption" = NULL, "shippingCents" = NULL, "totalCents" = NULL
WHERE "status" = 'AWAITING_PAYMENT';

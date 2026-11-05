-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('LABEL_CREATED', 'IN_TRANSIT', 'DELIVERED');

-- AlterEnum
ALTER TYPE "EndEmailKind" ADD VALUE 'SHIPPED';
ALTER TYPE "EndEmailKind" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "EndEmailKind" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "shipmentStatus" "ShipmentStatus",
ADD COLUMN "trackingCode" TEXT,
ADD COLUMN "shippedAt" TIMESTAMP(3),
ADD COLUMN "inTransitAt" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_shipmentStatus_idx" ON "Order"("shipmentStatus");

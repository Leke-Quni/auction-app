-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EndEmailKind" AS ENUM ('LOST', 'WON');

-- AlterTable
ALTER TABLE "PendingEndEmail" ADD COLUMN "kind" "EndEmailKind" NOT NULL DEFAULT 'LOST';

-- DropIndex
DROP INDEX "PendingEndEmail_userId_listingId_key";

-- CreateIndex
CREATE UNIQUE INDEX "PendingEndEmail_userId_listingId_kind_key" ON "PendingEndEmail"("userId", "listingId", "kind");

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "sellerNetCents" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "round" INTEGER NOT NULL DEFAULT 1,
    "payBy" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_buyerId_idx" ON "Order"("buyerId");

-- CreateIndex
CREATE INDEX "Order_sellerId_idx" ON "Order"("sellerId");

-- CreateIndex
CREATE INDEX "Order_status_payBy_idx" ON "Order"("status", "payBy");

-- CreateIndex
CREATE UNIQUE INDEX "Order_listingId_round_key" ON "Order"("listingId", "round");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales that closed before orders existed are left without one: nobody is asked to pay for an auction that ended earlier.

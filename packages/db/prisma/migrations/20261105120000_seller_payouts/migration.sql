-- AlterEnum
ALTER TYPE "EndEmailKind" ADD VALUE 'PAYOUT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "payoutAccountId" TEXT;

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_payoutAccountId_key" ON "User"("payoutAccountId");
CREATE UNIQUE INDEX "Payout_orderId_key" ON "Payout"("orderId");
CREATE INDEX "Payout_sellerId_idx" ON "Payout"("sellerId");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

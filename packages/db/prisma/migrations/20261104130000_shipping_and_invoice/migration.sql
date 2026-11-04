-- AlterEnum
ALTER TYPE "EndEmailKind" ADD VALUE 'PAID';
ALTER TYPE "EndEmailKind" ADD VALUE 'SOLD';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "shipFromCountry" TEXT, ADD COLUMN "shipFromCity" TEXT;

-- AlterTable
ALTER TABLE "Order"
  ADD COLUMN "shippingAddress" JSONB,
  ADD COLUMN "shippingOption" JSONB,
  ADD COLUMN "shippingCents" INTEGER,
  ADD COLUMN "totalCents" INTEGER,
  ADD COLUMN "invoiceNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

-- CreateSequence
CREATE SEQUENCE "InvoiceNumberSeq";

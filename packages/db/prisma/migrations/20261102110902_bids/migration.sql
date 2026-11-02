-- CreateEnum
CREATE TYPE "BidOutcome" AS ENUM ('ACCEPTED', 'REFUSED');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "bidCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentBidCents" INTEGER,
ADD COLUMN     "highBidderId" TEXT;

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "listingId" TEXT,
    "amountCents" INTEGER,
    "ip" TEXT,
    "outcome" "BidOutcome" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bid_listingId_amountCents_idx" ON "Bid"("listingId", "amountCents" DESC);

-- CreateIndex
CREATE INDEX "Bid_bidderId_idx" ON "Bid"("bidderId");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_bidderId_idempotencyKey_key" ON "Bid"("bidderId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BidAudit_userId_createdAt_idx" ON "BidAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BidAudit_listingId_createdAt_idx" ON "BidAudit"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "BidAudit_ip_createdAt_idx" ON "BidAudit"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_highBidderId_idx" ON "Listing"("highBidderId");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_highBidderId_fkey" FOREIGN KEY ("highBidderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the database itself, whatever code writes to it: a bid is a positive amount, and a listing's current bid and
-- bid count agree (no bids means no current bid; any bid means both are set).
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_amountCents_positive" CHECK ("amountCents" > 0);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_bid_fields_agree" CHECK (
  ("currentBidCents" IS NULL AND "bidCount" = 0 AND "highBidderId" IS NULL)
  OR ("currentBidCents" IS NOT NULL AND "currentBidCents" > 0 AND "bidCount" > 0)
);

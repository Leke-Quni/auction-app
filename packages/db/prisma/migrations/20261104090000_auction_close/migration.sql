-- CreateEnum
CREATE TYPE "ListingOutcome" AS ENUM ('SOLD', 'NO_SALE', 'NO_BIDS');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "outcome" "ListingOutcome",
ADD COLUMN "winnerId" TEXT,
ADD COLUMN "finalPriceCents" INTEGER;

-- CreateIndex
CREATE INDEX "Listing_winnerId_idx" ON "Listing"("winnerId");

-- CreateIndex
CREATE INDEX "Listing_status_closedAt_endsAt_idx" ON "Listing"("status", "closedAt", "endsAt");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Auctions that ended before closing existed are closed the same way the close job would close them.
UPDATE "Listing" SET
  "closedAt" = "endsAt",
  "outcome" = CASE
    WHEN "highBidderId" IS NULL THEN 'NO_BIDS'::"ListingOutcome"
    WHEN "reservePriceCents" IS NOT NULL AND "currentBidCents" < "reservePriceCents" THEN 'NO_SALE'::"ListingOutcome"
    ELSE 'SOLD'::"ListingOutcome"
  END,
  "winnerId" = CASE WHEN "highBidderId" IS NOT NULL AND ("reservePriceCents" IS NULL OR "currentBidCents" >= "reservePriceCents") THEN "highBidderId" END,
  "finalPriceCents" = CASE WHEN "highBidderId" IS NOT NULL AND ("reservePriceCents" IS NULL OR "currentBidCents" >= "reservePriceCents") THEN "currentBidCents" END
WHERE "status" = 'PUBLISHED' AND "endsAt" <= CURRENT_TIMESTAMP AND "closedAt" IS NULL;

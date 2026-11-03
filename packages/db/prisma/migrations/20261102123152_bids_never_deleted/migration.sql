-- DropForeignKey
ALTER TABLE "Bid" DROP CONSTRAINT "Bid_bidderId_fkey";

-- DropForeignKey
ALTER TABLE "Bid" DROP CONSTRAINT "Bid_listingId_fkey";

-- DropForeignKey
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_highBidderId_fkey";

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_highBidderId_fkey" FOREIGN KEY ("highBidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- With bids, a listing must always name its high bidder (before, a deleted account could leave a current bid with nobody
-- holding it). Together with the Restrict rules above, a listing or an account that has bids cannot be deleted.
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_bid_fields_agree";
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_bid_fields_agree" CHECK (
  ("currentBidCents" IS NULL AND "bidCount" = 0 AND "highBidderId" IS NULL)
  OR ("currentBidCents" IS NOT NULL AND "currentBidCents" > 0 AND "bidCount" > 0 AND "highBidderId" IS NOT NULL)
);

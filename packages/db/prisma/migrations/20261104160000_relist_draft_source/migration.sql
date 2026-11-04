-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "relistedFromId" TEXT;

-- CreateIndex
CREATE INDEX "Listing_relistedFromId_idx" ON "Listing"("relistedFromId");

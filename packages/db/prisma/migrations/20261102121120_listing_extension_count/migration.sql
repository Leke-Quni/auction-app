-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "extensionCount" INTEGER NOT NULL DEFAULT 0;

-- An auction is extended at most twice (see ANTI_SNIPING_STEPS in packages/shared).
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_extensionCount_range" CHECK ("extensionCount" BETWEEN 0 AND 2);

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "removedAt" TIMESTAMP(3),
ADD COLUMN "removedById" TEXT,
ADD COLUMN "removalReason" TEXT;

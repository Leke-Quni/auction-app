-- AlterEnum
ALTER TYPE "AdminActionKind" ADD VALUE 'STRIKE_USER';

-- AlterTable
ALTER TABLE "Strike" ADD COLUMN "reason" TEXT,
ADD COLUMN "givenById" TEXT,
ALTER COLUMN "listingId" DROP NOT NULL;

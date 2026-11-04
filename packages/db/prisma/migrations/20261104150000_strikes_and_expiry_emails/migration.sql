-- AlterEnum
ALTER TYPE "EndEmailKind" ADD VALUE 'EXPIRED';
ALTER TYPE "EndEmailKind" ADD VALUE 'NOT_PAID';

-- CreateTable
CREATE TABLE "Strike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Strike_orderId_key" ON "Strike"("orderId");

-- CreateIndex
CREATE INDEX "Strike_userId_idx" ON "Strike"("userId");

-- AddForeignKey
ALTER TABLE "Strike" ADD CONSTRAINT "Strike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

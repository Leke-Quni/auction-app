-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountDeletionCode" (
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionCode_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "AccountDeletionCode" ADD CONSTRAINT "AccountDeletionCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed accounts are looked up by when they were closed.
CREATE INDEX "User_deletionRequestedAt_idx" ON "User"("deletionRequestedAt") WHERE "deletionRequestedAt" IS NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "User_emailFingerprint_idx" ON "User"("emailFingerprint") WHERE "emailFingerprint" IS NOT NULL;

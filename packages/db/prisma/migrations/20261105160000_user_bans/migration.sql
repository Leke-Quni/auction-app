-- AlterTable
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3),
ADD COLUMN "banReason" TEXT;

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'ABUSE', 'CONTACT_DETAILS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'HANDLED');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "target" "VoteTarget" NOT NULL,
    "reporterId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_listingId_idx" ON "Report"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_questionId_target_reporterId_key" ON "Report"("questionId", "target", "reporterId");

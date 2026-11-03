-- AlterTable
ALTER TABLE "Report" ADD COLUMN "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropIndex
DROP INDEX "Report_questionId_target_reporterId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Report_questionId_target_reporterId_postedAt_key" ON "Report"("questionId", "target", "reporterId", "postedAt");

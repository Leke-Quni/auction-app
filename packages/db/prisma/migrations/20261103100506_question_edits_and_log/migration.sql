-- CreateEnum
CREATE TYPE "QuestionLogAction" AS ENUM ('CREATED', 'EDITED', 'DELETED');

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "answerEditedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuestionLog" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "target" "VoteTarget" NOT NULL,
    "action" "QuestionLogAction" NOT NULL,
    "actorId" TEXT,
    "body" TEXT NOT NULL,
    "previousBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionLog_questionId_createdAt_idx" ON "QuestionLog"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionLog_listingId_createdAt_idx" ON "QuestionLog"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionLog_actorId_createdAt_idx" ON "QuestionLog"("actorId", "createdAt");

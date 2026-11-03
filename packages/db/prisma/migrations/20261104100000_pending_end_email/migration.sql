-- CreateTable
CREATE TABLE "PendingEndEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingEndEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingEndEmail_dueAt_idx" ON "PendingEndEmail"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingEndEmail_userId_listingId_key" ON "PendingEndEmail"("userId", "listingId");

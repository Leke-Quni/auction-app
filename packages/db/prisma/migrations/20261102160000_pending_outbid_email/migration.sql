-- CreateTable
CREATE TABLE "PendingOutbidEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingOutbidEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingOutbidEmail_dueAt_idx" ON "PendingOutbidEmail"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingOutbidEmail_userId_listingId_key" ON "PendingOutbidEmail"("userId", "listingId");

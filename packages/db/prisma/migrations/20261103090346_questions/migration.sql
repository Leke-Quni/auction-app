-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "askerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Question_listingId_createdAt_idx" ON "Question"("listingId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Question_askerId_idx" ON "Question"("askerId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_askerId_fkey" FOREIGN KEY ("askerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A question has words and a sensible length, and an answer has its time (and the reverse).
ALTER TABLE "Question" ADD CONSTRAINT "Question_body_length" CHECK (char_length("body") BETWEEN 1 AND 1000);
ALTER TABLE "Question" ADD CONSTRAINT "Question_answer_length" CHECK ("answer" IS NULL OR char_length("answer") BETWEEN 1 AND 2000);
ALTER TABLE "Question" ADD CONSTRAINT "Question_answer_time" CHECK (("answer" IS NULL) = ("answeredAt" IS NULL));

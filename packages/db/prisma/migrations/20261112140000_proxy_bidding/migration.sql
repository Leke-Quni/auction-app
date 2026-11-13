-- CreateEnum
CREATE TYPE "BidKind" AS ENUM ('BID', 'AUTO', 'RAISE');

-- CreateEnum
CREATE TYPE "ProxyOutcome" AS ENUM ('LEADING', 'OUTBID_BY_PROXY', 'MAX_RAISED');

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "kind" "BidKind" NOT NULL DEFAULT 'BID',
ADD COLUMN     "maxCents" INTEGER,
ADD COLUMN     "outcome" "ProxyOutcome",
ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "AutoBid" (
    "listingId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "maxCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoBid_pkey" PRIMARY KEY ("listingId","bidderId")
);

-- CreateIndex
CREATE INDEX "AutoBid_bidderId_idx" ON "AutoBid"("bidderId");

-- AddForeignKey
ALTER TABLE "AutoBid" ADD CONSTRAINT "AutoBid_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoBid" ADD CONSTRAINT "AutoBid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A maximum is a positive amount, like a bid.
ALTER TABLE "AutoBid" ADD CONSTRAINT "AutoBid_maxCents_positive" CHECK ("maxCents" > 0);

-- Backfill, so an auction that is live when this runs behaves as if every bid had been a maximum equal to itself.
UPDATE "Bid" SET "maxCents" = "amountCents";

-- Rows made before this change are numbered in the order they were placed; new rows continue after the last.
WITH ordered AS (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n FROM "Bid")
UPDATE "Bid" b SET "seq" = ordered.n FROM ordered WHERE b."id" = ordered."id";
SELECT setval(pg_get_serial_sequence('"Bid"', 'seq'), GREATEST(COALESCE((SELECT MAX("seq") FROM "Bid"), 0), 1), (SELECT COUNT(*) > 0 FROM "Bid"));

INSERT INTO "AutoBid" ("listingId", "bidderId", "maxCents", "updatedAt")
SELECT "listingId", "bidderId", MAX("amountCents"), now() FROM "Bid" GROUP BY "listingId", "bidderId";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "paymentRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "Order" SET "paymentRefs" = ARRAY["paymentRef"] WHERE "paymentRef" IS NOT NULL;

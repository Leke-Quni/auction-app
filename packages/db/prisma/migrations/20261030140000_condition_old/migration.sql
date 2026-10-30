-- Replace the FOR_PARTS condition with OLD. Any existing FOR_PARTS listing becomes OLD.
CREATE TYPE "ListingCondition_new" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'OLD');

ALTER TABLE "Listing" ALTER COLUMN "condition" TYPE "ListingCondition_new" USING (
  CASE "condition"::text WHEN 'FOR_PARTS' THEN 'OLD' ELSE "condition"::text END
)::"ListingCondition_new";

ALTER TYPE "ListingCondition" RENAME TO "ListingCondition_old";
ALTER TYPE "ListingCondition_new" RENAME TO "ListingCondition";
DROP TYPE "ListingCondition_old";

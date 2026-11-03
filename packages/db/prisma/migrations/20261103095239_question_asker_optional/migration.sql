-- DropForeignKey
ALTER TABLE "Question" DROP CONSTRAINT "Question_askerId_fkey";

-- AlterTable
ALTER TABLE "Question" ALTER COLUMN "askerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_askerId_fkey" FOREIGN KEY ("askerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

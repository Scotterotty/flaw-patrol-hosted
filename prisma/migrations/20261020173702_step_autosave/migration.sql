-- AlterEnum
ALTER TYPE "ResultStatus" ADD VALUE 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "RunEntry" ADD COLUMN     "draft" JSONB,
ADD COLUMN     "draftAt" TIMESTAMP(3),
ADD COLUMN     "draftByName" TEXT NOT NULL DEFAULT '';

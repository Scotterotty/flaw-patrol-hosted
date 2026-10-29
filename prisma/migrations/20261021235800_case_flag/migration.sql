-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "flag" TEXT,
ADD COLUMN     "flagNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "flagRunNumber" INTEGER,
ADD COLUMN     "flaggedAt" TIMESTAMP(3),
ADD COLUMN     "flaggedBy" TEXT NOT NULL DEFAULT '';

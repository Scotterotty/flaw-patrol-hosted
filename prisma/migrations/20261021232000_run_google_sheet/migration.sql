-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sheetSecret" TEXT;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "sheetAuto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sheetError" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sheetHook" TEXT,
ADD COLUMN     "sheetLink" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sheetSyncedAt" TIMESTAMP(3),
ADD COLUMN     "sheetTab" TEXT NOT NULL DEFAULT '';

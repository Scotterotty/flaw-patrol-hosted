-- AlterTable
ALTER TABLE "BashItem" ADD COLUMN     "build" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "environment" TEXT NOT NULL DEFAULT '';

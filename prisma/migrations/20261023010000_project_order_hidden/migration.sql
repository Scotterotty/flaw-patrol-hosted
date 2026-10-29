-- AlterTable
ALTER TABLE "ProjectPin" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "position" INTEGER;

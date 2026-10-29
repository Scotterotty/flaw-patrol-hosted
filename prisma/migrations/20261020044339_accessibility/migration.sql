-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "strongContrast" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "textSize" TEXT NOT NULL DEFAULT '100',
ADD COLUMN     "underlineLinks" BOOLEAN NOT NULL DEFAULT false;

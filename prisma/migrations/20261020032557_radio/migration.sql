-- AlterTable
ALTER TABLE "User" ADD COLUMN     "radioEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "radioStation" TEXT NOT NULL DEFAULT 'fluid';

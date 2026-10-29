-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gameEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gameFrame" TEXT,
ADD COLUMN     "gameTitle" TEXT;

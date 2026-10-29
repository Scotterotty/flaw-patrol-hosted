-- AlterTable
ALTER TABLE "User" ADD COLUMN "spelling" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "spelling" TEXT NOT NULL DEFAULT 'us';

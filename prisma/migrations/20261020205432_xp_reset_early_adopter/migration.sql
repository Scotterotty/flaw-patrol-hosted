-- AlterTable
ALTER TABLE "User" ADD COLUMN     "earlyAdopter" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "xpSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "launchedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

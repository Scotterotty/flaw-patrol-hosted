-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "rolesChosenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectGroup" ADD COLUMN     "rolesChosenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "colorVision" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN     "crownsSeen" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gameTitleBefore" TEXT,
ADD COLUMN     "openCards" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visionShapes" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Crown" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userId" TEXT,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Crown_userId_idx" ON "Crown"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Crown_groupId_key_key" ON "Crown"("groupId", "key");

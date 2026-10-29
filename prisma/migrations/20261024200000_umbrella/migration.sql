-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "keepMembersSeparate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rcName" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ProjectGroup" ADD COLUMN     "hubProjectId" TEXT,
ADD COLUMN     "platforms" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "shortcuts" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "fromUmbrella" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGroup_hubProjectId_key" ON "ProjectGroup"("hubProjectId");

-- AddForeignKey
ALTER TABLE "ProjectGroup" ADD CONSTRAINT "ProjectGroup_hubProjectId_fkey" FOREIGN KEY ("hubProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;


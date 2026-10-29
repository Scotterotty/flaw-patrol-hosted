-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "ProjectGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPin" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER,

    CONSTRAINT "GroupPin_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateIndex
CREATE INDEX "Project_groupId_idx" ON "Project"("groupId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPin" ADD CONSTRAINT "GroupPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPin" ADD CONSTRAINT "GroupPin_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;


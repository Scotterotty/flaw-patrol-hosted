-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectPin" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "visitedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectPin_pkey" PRIMARY KEY ("userId","projectId")
);

-- AddForeignKey
ALTER TABLE "ProjectPin" ADD CONSTRAINT "ProjectPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPin" ADD CONSTRAINT "ProjectPin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

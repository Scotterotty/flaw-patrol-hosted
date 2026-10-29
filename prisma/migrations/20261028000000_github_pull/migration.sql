-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "githubRepoId" TEXT,
ADD COLUMN     "githubRunId" TEXT,
ADD COLUMN     "githubRunNo" INTEGER,
ADD COLUMN     "githubRunUrl" TEXT;

-- CreateTable
CREATE TABLE "GitHubRepo" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "workflowId" TEXT,
    "workflowName" TEXT NOT NULL DEFAULT '',
    "resultsGlob" TEXT NOT NULL DEFAULT '*.xml',
    "lastPulledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubRepo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubRepo_groupId_fullName_key" ON "GitHubRepo"("groupId", "fullName");

-- CreateIndex
CREATE INDEX "TestRun_githubRepoId_githubRunId_idx" ON "TestRun"("githubRepoId", "githubRunId");

-- AddForeignKey
ALTER TABLE "GitHubRepo" ADD CONSTRAINT "GitHubRepo_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_githubRepoId_fkey" FOREIGN KEY ("githubRepoId") REFERENCES "GitHubRepo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

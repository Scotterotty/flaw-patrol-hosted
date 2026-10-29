-- AlterTable
ALTER TABLE "Defect" ADD COLUMN     "externalCategory" TEXT,
ADD COLUMN     "externalStatus" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JiraConfig" (
    "projectId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "jiraProjectKey" TEXT NOT NULL,
    "issueType" TEXT NOT NULL DEFAULT 'Bug',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraConfig_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "Defect_projectId_externalKey_idx" ON "Defect"("projectId", "externalKey");

-- AddForeignKey
ALTER TABLE "JiraConfig" ADD CONSTRAINT "JiraConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

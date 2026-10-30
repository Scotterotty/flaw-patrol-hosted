-- ver_96: schema changes (Sentry, bug bash finds and links, company bug templates, Explored status, known bug checks, Added rows, and more).

-- from 20261029223501_ver96_wip
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

-- from 20261029224532_ver96_wip2
-- AlterTable
ALTER TABLE "TestResult" ADD COLUMN     "sentry" JSONB;

-- CreateTable
CREATE TABLE "SentryConfig" (
    "projectId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://sentry.io',
    "org" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "connectedAs" TEXT NOT NULL DEFAULT '',
    "projects" JSONB NOT NULL DEFAULT '[]',
    "environment" TEXT NOT NULL DEFAULT '',
    "buildField" TEXT NOT NULL DEFAULT 'build',
    "onlyTester" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SentryConfig_pkey" PRIMARY KEY ("projectId")
);

-- AddForeignKey
ALTER TABLE "SentryConfig" ADD CONSTRAINT "SentryConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- from 20261029225335_ver96_wip3
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "tagColors" JSONB NOT NULL DEFAULT '{}';

-- from 20261029231910_ver96_wip4
-- AlterEnum
ALTER TYPE "ResultStatus" ADD VALUE 'EXPLORED';

-- from 20261029233836_ver96_wip5
-- AlterTable
ALTER TABLE "JiraConfig" ADD COLUMN     "sharedTemplateId" TEXT;

-- CreateTable
CREATE TABLE "SharedBugTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL,
    "domains" TEXT[],
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedBugTemplate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JiraConfig" ADD CONSTRAINT "JiraConfig_sharedTemplateId_fkey" FOREIGN KEY ("sharedTemplateId") REFERENCES "SharedBugTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- from 20261029235606_ver96_wip6
-- AlterTable
ALTER TABLE "BashItem" ADD COLUMN     "replyToId" TEXT;

-- AlterTable
ALTER TABLE "BugBash" ADD COLUMN     "links" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "BashItem_replyToId_idx" ON "BashItem"("replyToId");

-- from 20261030001542_ver96_wip7
-- CreateTable
CREATE TABLE "DefectCheck" (
    "id" TEXT NOT NULL,
    "defectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "byId" TEXT,
    "byName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefectCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectCheck_runId_idx" ON "DefectCheck"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "DefectCheck_defectId_entryId_key" ON "DefectCheck"("defectId", "entryId");

-- AddForeignKey
ALTER TABLE "DefectCheck" ADD CONSTRAINT "DefectCheck_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "Defect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectCheck" ADD CONSTRAINT "DefectCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- from 20261030003512_ver96_wip8
-- AlterTable
ALTER TABLE "RunEntry" ADD COLUMN     "addedNote" TEXT NOT NULL DEFAULT '';

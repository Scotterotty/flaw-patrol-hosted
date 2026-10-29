-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "bashItemId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'file';

-- AlterTable
ALTER TABLE "GitHubRepo" ADD COLUMN     "bringFiles" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ProjectGroup" ADD COLUMN     "automationFiles" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "regression" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "RunEntry" ADD COLUMN     "regressionOff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "regressionOffBy" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "TestResult" ADD COLUMN     "testSteps" JSONB;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "filesDeletedAt" TIMESTAMP(3),
ADD COLUMN     "filesDeletedBy" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "navOrder" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CharterTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "with" TEXT NOT NULL DEFAULT '',
    "discover" TEXT NOT NULL DEFAULT '',
    "minutes" INTEGER NOT NULL DEFAULT 30,
    "prompts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugBash" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "name" TEXT NOT NULL,
    "release" TEXT NOT NULL DEFAULT '',
    "minutes" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "wrappedAt" TIMESTAMP(3),
    "areas" JSONB NOT NULL DEFAULT '[]',
    "collectFirst" BOOLEAN NOT NULL DEFAULT true,
    "slack" BOOLEAN NOT NULL DEFAULT true,
    "funExtras" BOOLEAN NOT NULL DEFAULT false,
    "slackStartAt" TIMESTAMP(3),
    "slackWarnAt" TIMESTAMP(3),
    "slackDoneAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugBash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BashPerson" (
    "bashId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BashPerson_pkey" PRIMARY KEY ("bashId","userId")
);

-- CreateTable
CREATE TABLE "BashItem" (
    "id" TEXT NOT NULL,
    "bashId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "severity" "Severity" NOT NULL DEFAULT 'PROBLEMATIC',
    "byId" TEXT,
    "byName" TEXT NOT NULL DEFAULT '',
    "plusOnes" JSONB NOT NULL DEFAULT '[]',
    "review" TEXT NOT NULL DEFAULT 'file',
    "mergedIntoId" TEXT,
    "defectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BashItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRating" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "movedById" TEXT,
    "movedBy" TEXT NOT NULL DEFAULT '',
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CharterTemplate_projectId_idx" ON "CharterTemplate"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BugBash_runId_key" ON "BugBash"("runId");

-- CreateIndex
CREATE INDEX "BugBash_projectId_createdAt_idx" ON "BugBash"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BashItem_bashId_createdAt_idx" ON "BashItem"("bashId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRating_projectId_release_issueKey_key" ON "RiskRating"("projectId", "release", "issueKey");

-- CreateIndex
CREATE INDEX "Attachment_bashItemId_idx" ON "Attachment"("bashItemId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_bashItemId_fkey" FOREIGN KEY ("bashItemId") REFERENCES "BashItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharterTemplate" ADD CONSTRAINT "CharterTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugBash" ADD CONSTRAINT "BugBash_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugBash" ADD CONSTRAINT "BugBash_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BashPerson" ADD CONSTRAINT "BashPerson_bashId_fkey" FOREIGN KEY ("bashId") REFERENCES "BugBash"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BashItem" ADD CONSTRAINT "BashItem_bashId_fkey" FOREIGN KEY ("bashId") REFERENCES "BugBash"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRating" ADD CONSTRAINT "RiskRating_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


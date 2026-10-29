-- AlterTable
ALTER TABLE "JiraConfig" ADD COLUMN     "stories" JSONB;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "roleRules" JSONB,
ADD COLUMN     "slackChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "slackMode" TEXT NOT NULL DEFAULT 'umbrella';

-- AlterTable
ALTER TABLE "ProjectGroup" ADD COLUMN     "roleRules" JSONB;

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "jiraStories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "TestResult" ADD COLUMN     "automated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "failureMessage" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "output" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "stackTrace" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "automated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "sourceFile" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sourceHash" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "searchRecent" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "SlackChannel" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "webhookEncrypted" TEXT NOT NULL,
    "alerts" JSONB NOT NULL DEFAULT '{}',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlackChannel_groupId_idx" ON "SlackChannel"("groupId");

-- CreateIndex
CREATE INDEX "SlackChannel_projectId_idx" ON "SlackChannel"("projectId");

-- CreateIndex
CREATE INDEX "TestRun_sourceHash_idx" ON "TestRun"("sourceHash");

-- AddForeignKey
ALTER TABLE "SlackChannel" ADD CONSTRAINT "SlackChannel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackChannel" ADD CONSTRAINT "SlackChannel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "bugProfile" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "JiraConfig" ADD COLUMN "bugTemplate" JSONB;

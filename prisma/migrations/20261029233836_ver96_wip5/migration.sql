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

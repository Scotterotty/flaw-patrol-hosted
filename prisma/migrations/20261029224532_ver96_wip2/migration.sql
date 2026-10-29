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

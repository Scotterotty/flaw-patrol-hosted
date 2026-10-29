-- CreateEnum
CREATE TYPE "RunState" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'DEFECTIVE', 'RETEST', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DefectStatus" AS ENUM ('OPEN', 'FIXED', 'CLOSED', 'WONT_FIX');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defectSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "needsUpdate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsUpdateNote" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "TestSuite" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuiteCase" (
    "suiteId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SuiteCase_pkey" PRIMARY KEY ("suiteId","caseId")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "suiteId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "build" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL DEFAULT '',
    "release" TEXT NOT NULL DEFAULT '',
    "state" "RunState" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEntry" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "preconditions" TEXT NOT NULL DEFAULT '',
    "priority" "Priority" NOT NULL,
    "folderPath" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL,
    "assigneeId" TEXT,
    "status" "ResultStatus" NOT NULL DEFAULT 'UNTESTED',
    "lastTestedAt" TIMESTAMP(3),

    CONSTRAINT "RunEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "status" "ResultStatus" NOT NULL,
    "stepResults" JSONB NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "elapsedSec" INTEGER,
    "testerId" TEXT,
    "testerName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Defect" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" "Severity" NOT NULL DEFAULT 'MAJOR',
    "status" "DefectStatus" NOT NULL DEFAULT 'OPEN',
    "externalKey" TEXT,
    "externalUrl" TEXT,
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectLink" (
    "defectId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "stepIndex" INTEGER,

    CONSTRAINT "DefectLink_pkey" PRIMARY KEY ("defectId","resultId")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resultId" TEXT,
    "stepIndex" INTEGER,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestSuite_projectId_idx" ON "TestSuite"("projectId");

-- CreateIndex
CREATE INDEX "TestRun_projectId_createdAt_idx" ON "TestRun"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_projectId_number_key" ON "TestRun"("projectId", "number");

-- CreateIndex
CREATE INDEX "RunEntry_caseId_idx" ON "RunEntry"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "RunEntry_runId_caseId_key" ON "RunEntry"("runId", "caseId");

-- CreateIndex
CREATE INDEX "TestResult_caseId_createdAt_idx" ON "TestResult"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "TestResult_runId_idx" ON "TestResult"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Defect_projectId_number_key" ON "Defect"("projectId", "number");

-- CreateIndex
CREATE INDEX "Attachment_resultId_idx" ON "Attachment"("resultId");

-- AddForeignKey
ALTER TABLE "TestSuite" ADD CONSTRAINT "TestSuite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteCase" ADD CONSTRAINT "SuiteCase_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteCase" ADD CONSTRAINT "SuiteCase_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "TestSuite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEntry" ADD CONSTRAINT "RunEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEntry" ADD CONSTRAINT "RunEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RunEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectLink" ADD CONSTRAINT "DefectLink_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "Defect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectLink" ADD CONSTRAINT "DefectLink_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TestResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "TestResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "TestSuite" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SuiteVersion" (
    "id" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "caseIds" JSONB NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuiteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuiteVersion_suiteId_version_key" ON "SuiteVersion"("suiteId", "version");

-- CreateIndex
CREATE INDEX "TestRun_projectId_release_idx" ON "TestRun"("projectId", "release");

-- AddForeignKey
ALTER TABLE "SuiteVersion" ADD CONSTRAINT "SuiteVersion_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

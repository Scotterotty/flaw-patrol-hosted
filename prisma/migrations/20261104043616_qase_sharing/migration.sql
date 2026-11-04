-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "qaseError" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "qaseRunId" INTEGER,
ADD COLUMN     "qaseRunTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "qaseSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "qaseId" INTEGER;

-- AlterTable
ALTER TABLE "TestResult" ADD COLUMN     "fromQase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qaseHash" TEXT;

-- CreateTable
CREATE TABLE "QaseConfig" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "projectTitle" TEXT NOT NULL DEFAULT '',
    "send" BOOLEAN NOT NULL DEFAULT true,
    "bring" BOOLEAN NOT NULL DEFAULT true,
    "statusMap" JSONB NOT NULL DEFAULT '{}',
    "hookSecret" TEXT NOT NULL,
    "connectedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaseConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QaseConfig_groupId_key" ON "QaseConfig"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "QaseConfig_hookSecret_key" ON "QaseConfig"("hookSecret");

-- CreateIndex
CREATE INDEX "TestResult_qaseHash_idx" ON "TestResult"("qaseHash");

-- AddForeignKey
ALTER TABLE "QaseConfig" ADD CONSTRAINT "QaseConfig_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

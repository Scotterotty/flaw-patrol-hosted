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

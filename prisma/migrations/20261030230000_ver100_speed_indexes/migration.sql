-- ver_100: indexes for the Umbrellas page (last activity and Your work). Only adds indexes.
-- CreateIndex
CREATE INDEX "RunEntry_assigneeId_status_idx" ON "RunEntry"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "TestCase_projectId_updatedAt_idx" ON "TestCase"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "TestResult_runId_createdAt_idx" ON "TestResult"("runId", "createdAt");


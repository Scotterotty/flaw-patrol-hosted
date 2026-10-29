-- Run pages read each case's last saved result (step pips on finished cases).
CREATE INDEX "TestResult_entryId_createdAt_idx" ON "TestResult"("entryId", "createdAt");

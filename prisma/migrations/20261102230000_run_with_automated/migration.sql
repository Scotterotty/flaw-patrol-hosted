-- Automated-only cases put in a run on purpose: the run page doesn't offer to take them out.
ALTER TABLE "TestRun" ADD COLUMN "withAutomated" BOOLEAN NOT NULL DEFAULT false;

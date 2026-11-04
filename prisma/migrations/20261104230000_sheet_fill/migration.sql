-- Fill in my columns: write results into a Google Sheet the team already keeps.
ALTER TABLE "TestRun" ADD COLUMN "sheetMode" TEXT NOT NULL DEFAULT 'tab';
ALTER TABLE "TestRun" ADD COLUMN "sheetFill" JSONB;
ALTER TABLE "TestRun" ADD COLUMN "sheetNote" TEXT NOT NULL DEFAULT '';

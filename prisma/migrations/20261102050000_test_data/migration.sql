-- Test data on test cases (ver_138)
ALTER TABLE "TestCase" ADD COLUMN "dataRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CaseVersion" ADD COLUMN "testData" JSONB;
ALTER TABLE "RunEntry" ADD COLUMN "testData" JSONB;

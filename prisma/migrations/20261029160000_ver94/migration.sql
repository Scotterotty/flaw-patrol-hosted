-- ver_94: pass/fail system. "Bug found" (DEFECTIVE) results become Failed, then the status goes away.
UPDATE "RunEntry" SET "status" = 'FAILED' WHERE "status" = 'DEFECTIVE';
UPDATE "TestResult" SET "status" = 'FAILED' WHERE "status" = 'DEFECTIVE';
UPDATE "TestResult" SET "stepResults" = replace("stepResults"::text, '"DEFECTIVE"', '"FAILED"')::jsonb WHERE "stepResults"::text LIKE '%"DEFECTIVE"%';
UPDATE "RunEntry" SET "draft" = replace("draft"::text, '"DEFECTIVE"', '"FAILED"')::jsonb WHERE "draft" IS NOT NULL AND "draft"::text LIKE '%"DEFECTIVE"%';
UPDATE "SavedReport" SET "query" = replace("query", 'DEFECTIVE', 'FAILED') WHERE "query" LIKE '%DEFECTIVE%';

ALTER TYPE "ResultStatus" RENAME TO "ResultStatus_old";
CREATE TYPE "ResultStatus" AS ENUM ('UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'RETEST', 'SKIPPED', 'IN_PROGRESS');
ALTER TABLE "RunEntry" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RunEntry" ALTER COLUMN "status" TYPE "ResultStatus" USING ("status"::text::"ResultStatus");
ALTER TABLE "RunEntry" ALTER COLUMN "status" SET DEFAULT 'UNTESTED';
ALTER TABLE "TestResult" ALTER COLUMN "status" TYPE "ResultStatus" USING ("status"::text::"ResultStatus");
DROP TYPE "ResultStatus_old";

-- Bug bash (ver_94): why a bug didn't go to Jira at wrap-up, shown on the report until it's filed.
ALTER TABLE "BashItem" ADD COLUMN "fileError" TEXT NOT NULL DEFAULT '';

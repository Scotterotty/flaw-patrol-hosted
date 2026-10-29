-- XP for writing cases, shared steps and suites only counts work from this moment on.
ALTER TABLE "Workspace" ADD COLUMN "xpAuthoringSince" TIMESTAMP(3);
INSERT INTO "Workspace" ("id", "spelling", "xpAuthoringSince") VALUES (1, 'us', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "xpAuthoringSince" = CURRENT_TIMESTAMP;

-- Results brought in from a sheet earn no testing XP.
ALTER TABLE "TestResult" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;
UPDATE "TestResult" SET "imported" = true WHERE "comment" LIKE 'Imported from %';

-- Bugs linked from Jira or a sheet weren't filed by the person who added them.
ALTER TABLE "Defect" ADD COLUMN "filed" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Defect" SET "filed" = false WHERE "externalKey" IS NOT NULL AND "title" = "externalKey";

-- Who marked a bug Fixed or Closed in Flaw Patrol.
ALTER TABLE "Defect" ADD COLUMN "fixedById" TEXT;

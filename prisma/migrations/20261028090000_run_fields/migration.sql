-- Run fields (ver_89). New umbrellas start with no extra fields; every umbrella that
-- already exists keeps CSP version and the OKO bug layout, so nothing changes for it.
ALTER TABLE "ProjectGroup" ADD COLUMN "runFields" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ProjectGroup" ADD COLUMN "okoLayout" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ProjectGroup" SET "runFields" = '[{"id":"csp","name":"CSP version","type":"text","choices":[],"required":false,"rc":true,"jira":true}]', "okoLayout" = true;
ALTER TABLE "TestRun" ADD COLUMN "fields" JSONB NOT NULL DEFAULT '[]';

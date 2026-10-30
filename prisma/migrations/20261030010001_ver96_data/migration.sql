-- ver_96 data, in its own migration so the new Explored status is committed before it's used.

-- Exploring is never a pass or a fail (ver_96): older sessions and bug bash areas become Explored.
UPDATE "TestResult" r SET status = 'EXPLORED' FROM "RunEntry" e WHERE r."entryId" = e.id AND e.kind = 'EXPLORATORY' AND r.status IN ('PASSED', 'FAILED');
UPDATE "RunEntry" SET status = 'EXPLORED' WHERE kind = 'EXPLORATORY' AND status IN ('PASSED', 'FAILED');
-- Company bug templates (ver_96): the ready-made OKO layout, shared with @magnopus.com, used where the OKO layout is on.
INSERT INTO "SharedBugTemplate" (id, name, source, settings, domains, "createdBy", "createdAt", "updatedAt")
VALUES ('shared_oko_layout', 'OKO bug layout', 'Ready-made layout from OB-5292', '{"on":true,"clientTag":"","team":"","clients":[],"olyEnv":[],"imported":null}', '{magnopus.com}', 'Flaw Patrol', NOW(), NOW());
UPDATE "JiraConfig" SET "sharedTemplateId" = 'shared_oko_layout' WHERE ("bugTemplate"->>'on') = 'true' AND ("bugTemplate"->'imported' IS NULL OR "bugTemplate"->'imported' = 'null'::jsonb);

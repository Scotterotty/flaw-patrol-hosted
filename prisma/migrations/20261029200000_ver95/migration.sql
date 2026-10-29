-- ver_95: which Playwright attempt made each automation file.
ALTER TABLE "Attachment" ADD COLUMN "attempt" INTEGER;

-- ver_95: cases made from automation read like the rest. "Shop › adds an item" is
-- "Adds an item" (the full test name stays in the Automation ID), and the
-- Automation / shop folder is Automation / Shop. Nothing is deleted.
UPDATE "TestCase" t SET "title" = upper(left(s.x, 1)) || substr(s.x, 2)
FROM (SELECT "id", regexp_replace("title", '^.* › ', '') AS x FROM "TestCase" WHERE "type" = 'AUTOMATED' AND "title" LIKE '% › %') s
WHERE t."id" = s."id" AND s.x <> '';
UPDATE "CaseVersion" v SET "title" = t."title"
FROM "TestCase" t
WHERE v."caseId" = t."id" AND v."version" = t."currentVersion" AND t."type" = 'AUTOMATED' AND v."title" LIKE '% › %';
UPDATE "Folder" f SET "name" = CASE WHEN length(f."name") <= 3 THEN upper(f."name") ELSE upper(left(f."name", 1)) || substr(f."name", 2) END
FROM "Folder" p
WHERE f."parentId" = p."id" AND p."parentId" IS NULL AND p."name" = 'Automation' AND f."name" ~ '^[a-z0-9-]+$';
UPDATE "CaseVersion" v SET "folderPath" = 'Automation / ' || CASE WHEN length(substr(v."folderPath", 14)) <= 3 THEN upper(substr(v."folderPath", 14)) ELSE upper(substr(v."folderPath", 14, 1)) || substr(v."folderPath", 15) END
FROM "TestCase" t
WHERE v."caseId" = t."id" AND v."version" = t."currentVersion" AND t."type" = 'AUTOMATED' AND v."folderPath" ~ '^Automation / [a-z0-9-]+$';

-- ver_95: run kinds. Old hand-tested runs with a release are release candidates, bug bash runs are
-- bug bashes, and the rest stay plain runs ("Run").
ALTER TABLE "ProjectGroup" ADD COLUMN "runKinds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "TestRun" ADD COLUMN "kind" TEXT NOT NULL DEFAULT '';
UPDATE "TestRun" SET "kind" = 'bash' WHERE "id" IN (SELECT "runId" FROM "BugBash" WHERE "runId" IS NOT NULL);
UPDATE "TestRun" SET "kind" = 'rc' WHERE "kind" = '' AND "release" <> '' AND "automated" = false;

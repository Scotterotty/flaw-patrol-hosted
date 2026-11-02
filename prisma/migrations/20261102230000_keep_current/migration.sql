-- Keep in Current: a pinned test cycle stays in Current when a newer one for its platform comes along.
ALTER TABLE "Project" ADD COLUMN "keepCurrent" BOOLEAN NOT NULL DEFAULT false;

-- Test cycles made for automation ("Build health", the default name) start pinned.
UPDATE "Project" SET "keepCurrent" = true WHERE "groupId" IS NOT NULL AND lower(trim("name")) = 'build health';

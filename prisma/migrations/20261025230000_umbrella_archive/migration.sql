-- Umbrellas can be archived; their projects go with them and come back on restore.
ALTER TABLE "ProjectGroup" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "archivedWithUmbrella" BOOLEAN NOT NULL DEFAULT false;

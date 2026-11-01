-- Email digests and email groups (ver_132).
ALTER TABLE "User" ADD COLUMN "digestPrefs" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Workspace" ADD COLUMN "digestStopped" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Project" ADD COLUMN "emailDigestMode" TEXT NOT NULL DEFAULT 'umbrella';
ALTER TABLE "Project" ADD COLUMN "emailDigest" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ProjectGroup" ADD COLUMN "emailDigest" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "EmailGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailGroup_name_key" ON "EmailGroup"("name");

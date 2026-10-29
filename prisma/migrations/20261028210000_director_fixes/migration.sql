-- ver_91: Start next RC carry-over kept for a test cycle's first run
ALTER TABLE "Project" ADD COLUMN "carryOver" JSONB;

-- ver_91: Settings → Jira → Severity field
ALTER TABLE "JiraConfig" ADD COLUMN "severity" JSONB;
-- Jira connections made before ver_91 keep the A to E scale they used.
UPDATE "JiraConfig" SET "severity" = '{"fieldId": null, "fieldName": "Severity", "values": ["A - Showstopper", "B - Critical", "C - Problematic", "D - Minor", "E - Enhancement"], "critical": ["A - Showstopper", "B - Critical"]}'::jsonb;

-- ver_91: CI upload tokens per umbrella
CREATE TABLE "CiToken" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "CiToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CiToken_hash_key" ON "CiToken"("hash");
CREATE INDEX "CiToken_groupId_idx" ON "CiToken"("groupId");
ALTER TABLE "CiToken" ADD CONSTRAINT "CiToken_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

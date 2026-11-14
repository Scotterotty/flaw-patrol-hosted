-- Bug audit (ver_250): a team pass over a Jira filter of old bugs.
CREATE TABLE "BugAudit" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jql" TEXT NOT NULL,
    "filterId" TEXT,
    "label" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3),
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "BugAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BugAuditCheck" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "claimedById" TEXT,
    "claimedBy" TEXT NOT NULL DEFAULT '',
    "claimedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL DEFAULT '',
    "clients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "build" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "changes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "movedTo" TEXT NOT NULL DEFAULT '',
    "checkedById" TEXT,
    "checkedBy" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "BugAuditCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BugAudit_groupId_idx" ON "BugAudit"("groupId");
CREATE UNIQUE INDEX "BugAuditCheck_auditId_issueKey_key" ON "BugAuditCheck"("auditId", "issueKey");
CREATE INDEX "BugAuditCheck_auditId_checkedAt_idx" ON "BugAuditCheck"("auditId", "checkedAt");

ALTER TABLE "BugAudit" ADD CONSTRAINT "BugAudit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BugAuditCheck" ADD CONSTRAINT "BugAuditCheck_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "BugAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bug templates (ver_119)
CREATE TABLE "BugTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hint" TEXT NOT NULL DEFAULT '',
    "layout" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BugTemplate_projectId_idx" ON "BugTemplate"("projectId");
ALTER TABLE "BugTemplate" ADD CONSTRAINT "BugTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "bugTemplateDefault" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Defect" ADD COLUMN "templateName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Defect" ADD COLUMN "layout" JSONB;
ALTER TABLE "Defect" ADD COLUMN "answers" JSONB;

ALTER TABLE "Attachment" ADD COLUMN "defectId" TEXT;
CREATE INDEX "Attachment_defectId_idx" ON "Attachment"("defectId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "Defect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bug bashes use bug templates (ver_125).
ALTER TABLE "BugBash" ADD COLUMN "bugTemplateId" TEXT;
ALTER TABLE "BashItem" ADD COLUMN "templateId" TEXT;
ALTER TABLE "BashItem" ADD COLUMN "templateName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BashItem" ADD COLUMN "layout" JSONB;
ALTER TABLE "BashItem" ADD COLUMN "answers" JSONB;

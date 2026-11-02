-- Found-in version on Jira bugs (ver_141)
ALTER TABLE "JiraConfig" ADD COLUMN "foundIn" JSONB;
ALTER TABLE "Defect" ADD COLUMN "foundIn" TEXT NOT NULL DEFAULT '';

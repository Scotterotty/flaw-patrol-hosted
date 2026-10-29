-- Severities now follow the team's Jira: A - Showstopper, B - Critical, C - Problematic, D - Minor, E - Enhancement.
ALTER TYPE "Severity" RENAME VALUE 'MAJOR' TO 'PROBLEMATIC';
ALTER TYPE "Severity" RENAME VALUE 'TRIVIAL' TO 'ENHANCEMENT';
ALTER TYPE "Severity" ADD VALUE 'SHOWSTOPPER' BEFORE 'CRITICAL';
ALTER TABLE "Defect" ALTER COLUMN "severity" SET DEFAULT 'PROBLEMATIC';

-- Jira's Priority, read from Jira for reports.
ALTER TABLE "Defect" ADD COLUMN "externalPriority" TEXT;

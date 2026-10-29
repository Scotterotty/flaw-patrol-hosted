-- Exploratory sessions: charters (a kind of case), personas, and session logs on results.
ALTER TYPE "CaseType" ADD VALUE 'EXPLORATORY';

CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🧑',
    "description" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Persona_projectId_name_key" ON "Persona"("projectId", "name");
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TestCase" ADD COLUMN "personaId" TEXT;
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CaseVersion" ADD COLUMN "charter" JSONB,
ADD COLUMN "personaName" TEXT NOT NULL DEFAULT '';

ALTER TABLE "RunEntry" ADD COLUMN "kind" "CaseType" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "charter" JSONB,
ADD COLUMN "persona" JSONB;

ALTER TABLE "TestResult" ADD COLUMN "sessionLog" JSONB;

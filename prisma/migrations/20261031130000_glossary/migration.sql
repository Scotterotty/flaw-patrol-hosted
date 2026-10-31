-- Glossary (ver_113): the team's shared words, their history and who looked them up.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "glossaryUnderline" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meaning" TEXT NOT NULL DEFAULT '',
    "question" TEXT NOT NULL DEFAULT '',
    "groupId" TEXT,
    "foundLabel" TEXT NOT NULL DEFAULT '',
    "foundUrl" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answerUnseen" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryVersion" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meaning" TEXT NOT NULL DEFAULT '',
    "groupId" TEXT,
    "byId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlossaryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryLookup" (
    "termId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlossaryLookup_pkey" PRIMARY KEY ("termId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTerm_key_key" ON "GlossaryTerm"("key");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTerm_slug_key" ON "GlossaryTerm"("slug");

-- CreateIndex
CREATE INDEX "GlossaryTerm_createdById_idx" ON "GlossaryTerm"("createdById");

-- CreateIndex
CREATE INDEX "GlossaryTerm_answeredById_idx" ON "GlossaryTerm"("answeredById");

-- CreateIndex
CREATE INDEX "GlossaryVersion_termId_createdAt_idx" ON "GlossaryVersion"("termId", "createdAt");

-- AddForeignKey
ALTER TABLE "GlossaryVersion" ADD CONSTRAINT "GlossaryVersion_termId_fkey" FOREIGN KEY ("termId") REFERENCES "GlossaryTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryLookup" ADD CONSTRAINT "GlossaryLookup_termId_fkey" FOREIGN KEY ("termId") REFERENCES "GlossaryTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;


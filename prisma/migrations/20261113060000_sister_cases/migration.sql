-- Sister cases: dry run results fill the linked steps of RC cases.
ALTER TABLE "RunEntry" ADD COLUMN "sisterFill" JSONB;

CREATE TABLE "SisterLink" (
    "id" TEXT NOT NULL,
    "fromCaseId" TEXT NOT NULL,
    "fromClient" TEXT NOT NULL DEFAULT '',
    "toCaseId" TEXT NOT NULL,
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SisterLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SisterLink_fromCaseId_fromClient_toCaseId_key" ON "SisterLink"("fromCaseId", "fromClient", "toCaseId");
CREATE INDEX "SisterLink_toCaseId_idx" ON "SisterLink"("toCaseId");

ALTER TABLE "SisterLink" ADD CONSTRAINT "SisterLink_fromCaseId_fkey" FOREIGN KEY ("fromCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SisterLink" ADD CONSTRAINT "SisterLink_toCaseId_fkey" FOREIGN KEY ("toCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

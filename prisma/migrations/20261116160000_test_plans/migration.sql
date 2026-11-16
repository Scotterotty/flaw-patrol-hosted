-- Configurations and test plans: one run per value, grouped as a plan.
ALTER TABLE "ProjectGroup" ADD COLUMN "configurations" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Project" ADD COLUMN "planSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TestRun" ADD COLUMN "planId" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "planValues" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "TestPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "configs" JSONB NOT NULL DEFAULT '[]',
    "source" JSONB NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "state" "RunState" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TestPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestPlan_projectId_number_key" ON "TestPlan"("projectId", "number");
CREATE INDEX "TestRun_planId_idx" ON "TestRun"("planId");

ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TestPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "PasswordLink" ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'reset';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "activityKeepDays" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN     "joinDomains" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mailFromAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mailFromName" TEXT NOT NULL DEFAULT 'Flaw Patrol',
ADD COLUMN     "mailHost" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mailMode" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN     "mailPassEncrypted" TEXT,
ADD COLUMN     "mailPort" INTEGER NOT NULL DEFAULT 587,
ADD COLUMN     "mailSecurity" TEXT NOT NULL DEFAULT 'starttls',
ADD COLUMN     "mailUser" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "passwordSignIn" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SignInProvider" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT NOT NULL DEFAULT '',
    "tenantId" TEXT NOT NULL DEFAULT '',
    "issuer" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT '',
    "secretEncrypted" TEXT,
    "secretExpires" TIMESTAMP(3),
    "joinDomains" TEXT NOT NULL DEFAULT '',
    "testedAt" TIMESTAMP(3),
    "testedEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignInProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEntry" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "where" TEXT NOT NULL DEFAULT 'Workspace',
    "groupId" TEXT,
    "projectId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "ip" TEXT,

    CONSTRAINT "ActivityEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEntry_at_idx" ON "ActivityEntry"("at");

-- CreateIndex
CREATE INDEX "ActivityEntry_kind_at_idx" ON "ActivityEntry"("kind", "at");

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


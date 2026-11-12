-- TeamCity (ver_228): a read-only connection for the Status page.
CREATE TABLE "TeamCityConfig" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "buildTypes" JSONB NOT NULL DEFAULT '[]',
    "connectedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamCityConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamCityConfig_groupId_key" ON "TeamCityConfig"("groupId");

ALTER TABLE "TeamCityConfig" ADD CONSTRAINT "TeamCityConfig_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

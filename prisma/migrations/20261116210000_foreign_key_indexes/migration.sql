-- Hosted build (backend team review §3, "Missing foreign-key indexes"): every single-column
-- foreign key gets an index, so cascade deletes and lookups by these columns use it
-- instead of scanning the table. The tables are small enough that a plain CREATE INDEX
-- (a short write lock) is fine.

-- CreateIndex
CREATE INDEX "ActivityEntry_actorId_idx" ON "ActivityEntry"("actorId");

-- CreateIndex
CREATE INDEX "GroupPin_groupId_idx" ON "GroupPin"("groupId");

-- CreateIndex
CREATE INDEX "ProjectPin_projectId_idx" ON "ProjectPin"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE INDEX "TestCase_folderId_idx" ON "TestCase"("folderId");

-- CreateIndex
CREATE INDEX "TestCase_personaId_idx" ON "TestCase"("personaId");

-- CreateIndex
CREATE INDEX "SuiteCase_caseId_idx" ON "SuiteCase"("caseId");

-- CreateIndex
CREATE INDEX "TestRun_suiteId_idx" ON "TestRun"("suiteId");

-- CreateIndex
CREATE INDEX "DefectLink_resultId_idx" ON "DefectLink"("resultId");

-- CreateIndex
CREATE INDEX "Attachment_projectId_idx" ON "Attachment"("projectId");

-- CreateIndex
CREATE INDEX "JiraConfig_sharedTemplateId_idx" ON "JiraConfig"("sharedTemplateId");


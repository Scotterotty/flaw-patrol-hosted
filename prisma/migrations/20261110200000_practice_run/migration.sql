-- Practice run (ver_217): a private practice space for one person.
ALTER TABLE "Project" ADD COLUMN "practiceFor" TEXT;
CREATE UNIQUE INDEX "Project_practiceFor_key" ON "Project"("practiceFor");

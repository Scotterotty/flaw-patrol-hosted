-- Bug bash platforms (ver_146): which platforms people can pick, and what each person and find was on.
ALTER TABLE "BugBash" ADD COLUMN "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "BashPerson" ADD COLUMN "platform" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BashItem" ADD COLUMN "platform" TEXT NOT NULL DEFAULT '';

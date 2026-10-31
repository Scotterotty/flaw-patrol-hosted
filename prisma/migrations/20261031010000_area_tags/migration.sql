-- Area tags (ver_102): words a library said No to.
ALTER TABLE "Project" ADD COLUMN "areaSkip" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Loading spinners (ver_108): the ones each person ticked in Account → Appearance.
ALTER TABLE "User" ADD COLUMN "spinners" TEXT[] DEFAULT ARRAY['ring']::TEXT[];

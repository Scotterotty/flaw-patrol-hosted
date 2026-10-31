-- Cases already run in another tool before import, so runs don't tag them New (ver_107).
ALTER TABLE "TestCase" ADD COLUMN "runBefore" BOOLEAN NOT NULL DEFAULT false;

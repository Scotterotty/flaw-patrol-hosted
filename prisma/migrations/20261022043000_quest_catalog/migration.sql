-- Runs that already exist keep the first catalog of items and encounters; new runs get catalog 2.
ALTER TABLE "TestRun" ADD COLUMN "questCatalog" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TestRun" ALTER COLUMN "questCatalog" SET DEFAULT 2;

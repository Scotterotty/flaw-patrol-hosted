-- Quest pawns, worn gear and teamwork events (ver_67).
ALTER TABLE "User" ADD COLUMN "questPawn" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "User" ADD COLUMN "questColour" TEXT NOT NULL DEFAULT 'accent';
ALTER TABLE "User" ADD COLUMN "questGear" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "TestResult" ADD COLUMN "questGear" JSONB;
ALTER TABLE "TestRun" ALTER COLUMN "questCatalog" SET DEFAULT 3;

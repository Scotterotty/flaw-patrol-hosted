-- Easier reading (ver_265): an opt-in reading setting, and the answer to its one-time banner.
ALTER TABLE "User" ADD COLUMN "easierReading" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "readingAsk" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "readingAskAt" TIMESTAMP(3);

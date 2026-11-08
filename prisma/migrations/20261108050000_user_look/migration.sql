-- App-wide looks (ver_202): Classic, Mission control, High contrast, Whiteboard, Blueprint, Arcade.
ALTER TABLE "User" ADD COLUMN "look" TEXT NOT NULL DEFAULT 'classic';
-- The Risk board now follows the app look unless someone gives it its own (null = same as my look).
ALTER TABLE "User" ALTER COLUMN "riskLook" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "riskLook" DROP DEFAULT;
UPDATE "User" SET "riskLook" = NULL WHERE "riskLook" = 'classic';

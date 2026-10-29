-- Auto-equip first finds into empty pawn gear slots (ver_72).
ALTER TABLE "User" ADD COLUMN "questGearTouched" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "questGearAuto" TEXT[] DEFAULT ARRAY[]::TEXT[];

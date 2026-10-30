-- Seasonal quest maps (ver_98): on by default.
ALTER TABLE "User" ADD COLUMN     "seasonalMaps" BOOLEAN NOT NULL DEFAULT true;

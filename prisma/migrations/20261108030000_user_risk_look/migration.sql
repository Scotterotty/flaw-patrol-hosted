-- Risk board look, picked per person in Your account > Appearance.
ALTER TABLE "User" ADD COLUMN "riskLook" TEXT NOT NULL DEFAULT 'classic';

-- ver_94: hide an umbrella from your own Umbrellas page.
ALTER TABLE "GroupPin" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;

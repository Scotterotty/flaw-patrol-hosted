-- New accounts get Bungee headings (ver_77). Existing choices are kept.
ALTER TABLE "User" ALTER COLUMN "fontHeading" SET DEFAULT 'bungee';

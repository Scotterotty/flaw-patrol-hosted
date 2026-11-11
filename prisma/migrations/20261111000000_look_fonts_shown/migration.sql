-- ver_221: a look no longer forces its fonts over Text font and Heading font. Save the fonts
-- each look was showing as the person's own, so nothing changes on screen today and the
-- Appearance dropdowns now match what people see. They can pick other fonts from here on.
UPDATE "User" SET "fontBody" = 'atkinson', "fontHeading" = 'body' WHERE "look" = 'hc';
UPDATE "User" SET "fontBody" = 'jetbrains-mono', "fontHeading" = 'body' WHERE "look" = 'blue';
UPDATE "User" SET "fontHeading" = 'caveat' WHERE "look" = 'white';
UPDATE "User" SET "fontHeading" = 'pixel' WHERE "look" = 'arcade';
UPDATE "User" SET "fontHeading" = 'righteous' WHERE "look" = 'retro';

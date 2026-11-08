-- App-wide looks (ver_202): Classic, Mission control, High contrast, Whiteboard, Blueprint, Arcade.
ALTER TABLE "User" ADD COLUMN "look" TEXT NOT NULL DEFAULT 'classic';

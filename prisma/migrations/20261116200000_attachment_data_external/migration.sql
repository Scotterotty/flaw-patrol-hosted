-- Hosted build (backend team review §3, option 1): attachment files are read a slice at a
-- time (substring). With EXTERNAL storage Postgres keeps them uncompressed out of line, so a
-- slice reads only the pages it needs instead of unpacking the whole file each time.
-- Videos, screenshots and zipped traces are already compressed, so nothing is lost.
-- Applies to files saved from now on; older files still work, just read more slowly.
ALTER TABLE "Attachment" ALTER COLUMN "data" SET STORAGE EXTERNAL;

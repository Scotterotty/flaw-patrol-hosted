-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accent" TEXT NOT NULL DEFAULT 'violet',
ADD COLUMN     "avatar" BYTEA,
ADD COLUMN     "avatarAt" TIMESTAMP(3),
ADD COLUMN     "avatarType" TEXT,
ADD COLUMN     "themeMode" TEXT NOT NULL DEFAULT 'light';

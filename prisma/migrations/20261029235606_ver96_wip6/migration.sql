-- AlterTable
ALTER TABLE "BashItem" ADD COLUMN     "replyToId" TEXT;

-- AlterTable
ALTER TABLE "BugBash" ADD COLUMN     "links" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "BashItem_replyToId_idx" ON "BashItem"("replyToId");

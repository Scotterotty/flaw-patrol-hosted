-- CreateTable
CREATE TABLE "DelveSave" (
    "userId" TEXT NOT NULL,
    "keys" JSONB NOT NULL DEFAULT '{}',
    "cleared" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelveSave_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "DelveSave" ADD CONSTRAINT "DelveSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

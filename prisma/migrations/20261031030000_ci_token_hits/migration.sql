-- CI token rate limit counted in the database, so it survives restarts and holds across server instances.
CREATE TABLE "CiTokenHit" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CiTokenHit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CiTokenHit_tokenId_at_idx" ON "CiTokenHit"("tokenId", "at");

ALTER TABLE "CiTokenHit" ADD CONSTRAINT "CiTokenHit_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "CiToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

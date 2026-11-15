-- Ask to be added (ver_258): someone on no umbrella asks the workspace admins to add them.
CREATE TABLE "WorkspaceJoinRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceJoinRequest_userId_key" ON "WorkspaceJoinRequest"("userId");

ALTER TABLE "WorkspaceJoinRequest" ADD CONSTRAINT "WorkspaceJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

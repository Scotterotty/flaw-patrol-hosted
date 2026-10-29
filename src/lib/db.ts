import { PrismaClient } from "@prisma/client";

// Profile pictures and password hashes are only loaded where asked for
// (omit: { avatar: false }), so ordinary user queries stay small and safe.
const makeClient = () => new PrismaClient({ omit: { user: { avatar: true, passwordHash: true } } });

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> };

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

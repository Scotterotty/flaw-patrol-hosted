import { PrismaClient } from "@prisma/client";
import { capConnections } from "./db-url";

// Profile pictures and password hashes are only loaded where asked for
// (omit: { avatar: false }), so ordinary user queries stay small and safe.
// The connection cap (ver_244) leaves Postgres slots free for backups and IT's tools.
const makeClient = () =>
  new PrismaClient({
    datasourceUrl: capConnections(process.env.DATABASE_URL, process.env.DATABASE_POOL),
    omit: { user: { avatar: true, passwordHash: true } },
  });

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof makeClient> };

// One client per server, in production too, so a module loaded twice can't open a second pool.
export const db = globalForPrisma.prisma ?? makeClient();
globalForPrisma.prisma = db;

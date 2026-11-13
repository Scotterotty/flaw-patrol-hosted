// How many database connections Flaw Patrol keeps open (ver_244). Prisma's default is
// (CPUs × 2) + 1, so on a big shared server one copy of Flaw Patrol could take most of
// Postgres's 100 slots, leaving none for the update helper's backup or IT's tools.

export const DEFAULT_POOL = 10;

/**
 * The database address with a connection cap added, unless the address already sets one.
 * DATABASE_POOL (a number from 1 to 100) changes the cap without editing the address.
 */
export function capConnections(url: string | undefined, pool: string | undefined = undefined): string | undefined {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.searchParams.has("connection_limit")) return url;
  const n = pool && /^\d+$/.test(pool.trim()) ? Number(pool.trim()) : NaN;
  const cap = n >= 1 && n <= 100 ? n : DEFAULT_POOL;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${cap}`;
}

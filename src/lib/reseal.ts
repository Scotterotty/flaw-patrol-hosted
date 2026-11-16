import "server-only";
import { db } from "@/lib/db";
import { hasEncryptionKey, resealed } from "@/lib/crypto";

// Hosted build: once IT sets ENCRYPTION_KEY, values saved earlier (sealed with AUTH_SECRET)
// are re-sealed with ENCRYPTION_KEY when the server starts, so a later AUTH_SECRET change
// can't break saved tokens. Values that can't be opened are left alone (the settings pages
// already ask for those to be pasted again). Safe to run every start: it only touches "v1." values.

// Each place a sealed secret is kept: the table and its column.
const COLUMNS = [
  ["Jira tokens", "jiraConfig", "tokenEncrypted"],
  ["GitHub tokens", "gitHubRepo", "tokenEncrypted"],
  ["Qase tokens", "qaseConfig", "tokenEncrypted"],
  ["TeamCity tokens", "teamCityConfig", "tokenEncrypted"],
  ["Sentry tokens", "sentryConfig", "tokenEncrypted"],
  ["Slack links", "slackChannel", "webhookEncrypted"],
  ["company sign-in secrets", "signInProvider", "secretEncrypted"],
  ["mail passwords", "workspace", "mailPassEncrypted"],
] as const;

type Delegate = {
  findMany(args: object): Promise<Record<string, string | null>[]>;
  updateMany(args: object): Promise<{ count: number }>;
};

/** Re-seals AUTH_SECRET values with ENCRYPTION_KEY. Returns how many were moved over, by kind. */
export async function resealWithEncryptionKey(): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  if (!hasEncryptionKey()) return moved;
  for (const [name, model, column] of COLUMNS) {
    const table = db[model] as unknown as Delegate;
    const rows = await table.findMany({ where: { [column]: { startsWith: "v1." } }, select: { [column]: true } });
    for (const old of new Set(rows.map((r) => r[column]))) {
      const next = old ? resealed(old) : null;
      if (!next) continue;
      // Matched by the old value, so a token saved again in the meantime is left as it is.
      const { count } = await table.updateMany({ where: { [column]: old }, data: { [column]: next } });
      if (count) moved[name] = (moved[name] ?? 0) + count;
    }
  }
  return moved;
}

import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

// Automated-only cases: made from automation results (GitHub Pull, uploads) or imported as
// Automated. Automation already runs them, so runs people test by hand leave them out unless
// someone asks for them. Cases tested by hand that automation also runs ("Both") are MANUAL
// and always stay in.

export const ONLY_AUTOMATED = "Every case here is automated, and automation already runs those. Tick Also include the automated cases to run them anyway.";

/** Which of these cases are automated-only. */
export async function automatedIn(tx: Prisma.TransactionClient | PrismaClient, caseIds: string[]) {
  if (!caseIds.length) return new Set<string>();
  const rows = await tx.testCase.findMany({ where: { id: { in: caseIds }, type: "AUTOMATED" }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

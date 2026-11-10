import type { ResultStatus } from "@prisma/client";
import type { TestData } from "./test-data";

// Clients (ver_214): the apps or devices a test cycle tests each case on, like a demo dry run's
// Web, Unreal, Unity iOS and "Web (remote user)". Each case runs once per client it covers, riding on
// the test data rows the runner already has: the first test data column is "client". Pure, so the
// settings, the snapshot, the run page and the runner all share it.

export const MAX_CLIENTS = 8;
export const MAX_CLIENT_NAME = 40;
/** The test data column that names each row's client. {{client}} in a step fills in the client's name. */
export const CLIENT_COLUMN = "client";

/** Tidy a typed list: trimmed, no blanks, no repeats (ignoring case), at most MAX_CLIENTS. */
export function cleanClients(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_CLIENT_NAME);
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, MAX_CLIENTS);
}

const lower = (s: string) => s.toLowerCase();
const words = (s: string): string[] => lower(s).match(/[a-z0-9]+/g) ?? [];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Words for a client that its name doesn't spell out.
const SYNONYMS: Record<string, string[]> = {
  unreal: ["ueee", "ue5", "ue4", "unreal engine"],
  ios: ["ipad", "iphone"],
};
// Words that say a case covers every client.
const EVERY = /\b(all|every|each|both)\s+(other\s+)?(the\s+)?(clients?|platforms?|devices?|apps?)\b|\bcross[- ]platform\b|\ball\s+of\s+the\s+clients\b/i;
const FILLER = new Set(["user", "users", "the", "a", "an", "and", "or", "of", "on", "app", "client"]);

/**
 * The clients a case covers, guessed from its words (title, folder and steps), in the cycle's order.
 * "Web - Move an asset" is Web only; "on Web and Web Remote" is those two; "across all clients",
 * or no client named at all, is every client.
 */
export function guessClients(text: string, clients: readonly string[]): string[] {
  if (clients.length <= 1) return [...clients];
  if (EVERY.test(text)) return [...clients];
  const t = lower(text);
  // A client's own words: the ones no other client's name has ("remote" for "Web (remote user)").
  const own = clients.map((c, i) => words(c).filter((w) => !FILLER.has(w) && !clients.some((o, j) => j !== i && words(o).includes(w))));
  const hit = clients.map((c, i) => {
    const pats = [lower(c).trim(), ...own[i], ...own[i].flatMap((w): string[] => SYNONYMS[w] ?? [])];
    // A client named only with shared words ("Web"): its name must not run into another client's
    // own word, so "Web Remote" or "Web (remote user)" doesn't count as plain Web.
    const mineW = words(c);
    const others = own.flatMap((ws, j) => (j === i || !words(clients[j]).some((w) => mineW.includes(w)) ? [] : ws));
    const after = others.length ? `(?![ \\t(\\-]*(${others.map(escape).join("|")})\\b)` : "";
    return pats.filter(Boolean).some((p) => {
      const shared = !own[i].includes(p);
      return new RegExp(`(^|[^a-z0-9])${escape(p)}(?![a-z0-9])${shared ? after : ""}`, "i").test(t);
    });
  });
  const picked = clients.filter((_, i) => hit[i]);
  return picked.length ? picked : [...clients];
}

/** The clients a case runs on in a cycle: the ones picked on the case that the cycle has, or else the guess. */
export function clientsForCase(picked: readonly string[], cycle: readonly string[], text: string): string[] {
  if (!cycle.length) return [];
  const want = new Set(picked.map(lower));
  const kept = cycle.filter((c) => want.has(lower(c)));
  return kept.length ? kept : guessClients(text, cycle);
}

/** Test data for a run with clients: one row per client (times the case's own rows), client first. */
export function withClients(data: TestData | null, clients: readonly string[]): TestData {
  if (!data) return { columns: [CLIENT_COLUMN], rows: clients.map((c) => [c]) };
  const columns = data.columns.some((c) => lower(c) === CLIENT_COLUMN) ? data.columns.map((c) => (lower(c) === CLIENT_COLUMN ? `${c}_2` : c)) : data.columns;
  return { columns: [CLIENT_COLUMN, ...columns], rows: clients.flatMap((c) => data.rows.map((r) => [c, ...r])) };
}

/** The client a test data row is for, or null when the entry has no clients. */
export function clientOfRow(clients: readonly string[], data: TestData | null, row: number | undefined): string | null {
  if (!clients.length || !data || row === undefined) return null;
  return data.rows[row]?.[0] ?? null;
}

/** A row's label in client runs: "Unreal", or "Unreal · Safari" when the case has test data of its own. */
export function clientRowLabel(data: TestData, row: number): string {
  return (data.rows[row] ?? []).filter((v) => v !== "").join(" · ") || "(empty row)";
}

const WORST: ResultStatus[] = ["FAILED", "BLOCKED", "RETEST", "SKIPPED"];

/**
 * Each client's result from the step statuses (in step order). `rowOf[i]` is step i's test data row,
 * undefined for headings. A client passes when all its steps pass; the worst one wins otherwise.
 */
export function clientResults(clients: readonly string[], data: TestData | null, rowOf: (number | undefined)[], statuses: readonly ResultStatus[]): Record<string, ResultStatus> {
  const out: Record<string, ResultStatus> = {};
  for (const c of clients) {
    const mine = statuses.filter((_, i) => rowOf[i] !== undefined && clientOfRow(clients, data, rowOf[i]) === c);
    const marked: ResultStatus[] = mine.filter((s) => s !== "UNTESTED" && s !== "IN_PROGRESS");
    let s: ResultStatus = "UNTESTED";
    // A failed or blocked step decides at once; otherwise a client is done only when every step is.
    if (marked.includes("FAILED")) s = "FAILED";
    else if (marked.includes("BLOCKED")) s = "BLOCKED";
    else if (marked.length && marked.length < mine.length) s = "IN_PROGRESS";
    else if (marked.length) s = WORST.find((w) => marked.includes(w)) ?? "PASSED";
    out[c] = s;
  }
  return out;
}

/** The step indexes of one client's rows, headings left out. */
export function stepsOfClient(clients: readonly string[], data: TestData | null, rowOf: (number | undefined)[], client: string): number[] {
  return rowOf.flatMap((r, i) => (r !== undefined && clientOfRow(clients, data, r) === client ? [i] : []));
}

/** "Web, Unreal and Unity iOS". */
export function listClients(list: readonly string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Each client's result for a run entry, from its rows (`rowOf`, headings left out) and step results in the same order. */
export function entryClientResults(e: { clients: string[]; rowClient: string[]; rowOf: number[] }, progress: readonly ResultStatus[] | null): Record<string, ResultStatus> {
  const data = { columns: [CLIENT_COLUMN], rows: e.rowClient.map((c) => [c]) };
  return clientResults(e.clients, data, e.rowOf, progress ?? e.rowOf.map(() => "UNTESTED" as ResultStatus));
}

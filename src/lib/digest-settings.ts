import { z } from "zod";

// Email digests (ver_132). When a run finishes, a bug bash ends or a release's testing
// is done, Flaw Patrol can email a summary. The umbrella decides who it goes to
// (ProjectGroup.emailDigest); each person decides which ones they get (User.digestPrefs),
// and their choice wins. Shared by the server and the settings cards.

export type DigestKind = "run" | "bash" | "rc";

export type DigestSettings = {
  /** Off until someone saves the card. */
  on: boolean;
  /** People who tested in the run or joined the bug bash. */
  testers: boolean;
  /** Whoever started the run or bug bash. */
  starter: boolean;
  /** Everyone on the umbrella's (or test cycle's) team. */
  everyone: boolean;
  /** Email groups (EmailGroup ids). */
  groupIds: string[];
  /** Single addresses, lowercased. */
  addresses: string[];
  run: boolean;
  bash: boolean;
  rc: boolean;
};

export const DIGEST_DEFAULTS: DigestSettings = { on: false, testers: true, starter: true, everyone: false, groupIds: [], addresses: [], run: true, bash: true, rc: true };

export const DIGEST_KINDS: { id: DigestKind; label: string }[] = [
  { id: "run", label: "Run finished" },
  { id: "bash", label: "Bug bash ended" },
  { id: "rc", label: "Release testing done" },
];

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
/** A plain email address, or null. */
export function cleanEmail(v: string) {
  const s = v.trim().toLowerCase();
  return s.length <= 200 && EMAIL.test(s) ? s : null;
}

const settingsSchema = z.object({
  on: z.boolean().catch(false),
  testers: z.boolean().catch(true),
  starter: z.boolean().catch(true),
  everyone: z.boolean().catch(false),
  groupIds: z.array(z.string().max(40)).max(50).catch([]),
  addresses: z.array(z.string()).max(100).catch([]),
  run: z.boolean().catch(true),
  bash: z.boolean().catch(true),
  rc: z.boolean().catch(true),
});

export function parseDigestSettings(v: unknown): DigestSettings {
  const r = settingsSchema.safeParse({ ...DIGEST_DEFAULTS, ...(v && typeof v === "object" ? v : {}) });
  if (!r.success) return { ...DIGEST_DEFAULTS };
  return { ...r.data, addresses: [...new Set(r.data.addresses.map(cleanEmail).filter((e): e is string => !!e))] };
}

/** Whether this kind of digest goes out at all. */
export const sends = (s: DigestSettings, kind: DigestKind) => s.on && s[kind];

/** "Run finished and Bug bash ended to people who tested, whoever started it and Mobile leads". */
export function digestSummary(s: DigestSettings, groupNames: string[]) {
  if (!s.on) return "Off. Email a summary when a run finishes or a bug bash ends.";
  const what = DIGEST_KINDS.filter((k) => s[k.id]).map((k) => k.label);
  if (!what.length) return "On, but nothing ticked to send.";
  const who = [s.everyone ? "everyone" : "", s.testers ? "people who tested or joined" : "", s.starter && !s.everyone ? "whoever started it" : "", ...groupNames, ...(s.addresses.length ? [`${s.addresses.length} ${s.addresses.length === 1 ? "address" : "addresses"}`] : [])].filter(Boolean);
  return `${joinAnd(what)} to ${who.length ? joinAnd(who) : "nobody yet"}`;
}

export function joinAnd(list: string[]) {
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// ---- Your account → Emails I get ----

export type RunPref = "tested" | "all" | "none";
export type BashPref = "joined" | "all" | "none";
export type DigestPrefs = { runs: RunPref; bashes: BashPref; rc: boolean };
export const PREF_DEFAULTS: DigestPrefs = { runs: "tested", bashes: "joined", rc: true };

export const RUN_PREFS: { id: RunPref; label: string }[] = [
  { id: "tested", label: "Runs I tested in" },
  { id: "all", label: "All runs" },
  { id: "none", label: "None" },
];
export const BASH_PREFS: { id: BashPref; label: string }[] = [
  { id: "joined", label: "Bashes I joined" },
  { id: "all", label: "All bashes" },
  { id: "none", label: "None" },
];

const prefsSchema = z.object({ runs: z.enum(["tested", "all", "none"]).catch("tested"), bashes: z.enum(["joined", "all", "none"]).catch("joined"), rc: z.boolean().catch(true) });
export function parsePrefs(v: unknown): DigestPrefs {
  const r = prefsSchema.safeParse({ ...PREF_DEFAULTS, ...(v && typeof v === "object" ? v : {}) });
  return r.success ? r.data : { ...PREF_DEFAULTS };
}

export function prefsSummary(p: DigestPrefs) {
  const runs = RUN_PREFS.find((x) => x.id === p.runs)!.label;
  const bashes = BASH_PREFS.find((x) => x.id === p.bashes)!.label;
  return `${p.runs === "none" ? "No runs" : runs} · ${p.bashes === "none" ? "No bug bashes" : bashes} · release done ${p.rc ? "on" : "off"}`;
}

/**
 * Whether one member gets this digest. `listed` means the umbrella sends to them (they
 * tested, started it, are on the team when Everyone is ticked, or are in a group).
 * "All" adds every one in the umbrellas they belong to; None stops them all.
 */
export function memberGets(p: DigestPrefs, kind: DigestKind, listed: boolean) {
  if (kind === "rc") return p.rc && listed;
  const pref = kind === "run" ? p.runs : p.bashes;
  if (pref === "none") return false;
  return listed || pref === "all";
}

/** The Stop link in an email turns off just that kind. */
export function stopPrefs(p: DigestPrefs, kind: DigestKind): DigestPrefs {
  return kind === "run" ? { ...p, runs: "none" } : kind === "bash" ? { ...p, bashes: "none" } : { ...p, rc: false };
}

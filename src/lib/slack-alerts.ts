import type { Severity } from "@prisma/client";

// Slack alerts (ver_82): which alerts a channel gets. Shared by the server and the settings card.

export type AlertId = "reg" | "bug" | "block" | "run" | "rc" | "start" | "join";
export type Alerts = Record<AlertId, boolean> & { sev: Severity };

export const DEFAULT_ALERTS: Alerts = { reg: true, bug: true, sev: "CRITICAL", block: false, run: true, rc: true, start: false, join: true };

/** In the order the card lists them: what needs attention now, then progress. */
export const ALERTS: { id: AlertId; group: "now" | "progress"; label: string; tip: string }[] = [
  { id: "reg", group: "now", label: "Regression", tip: "A case that passed last time on the same platform now fails." },
  { id: "bug", group: "now", label: "Serious bug filed", tip: "A Jira bug filed from a run at the chosen severity or worse. Linking an existing bug doesn't post." },
  { id: "block", group: "now", label: "Case blocked", tip: "A tester marks a case Blocked, with their comment." },
  { id: "join", group: "now", label: "Someone asks to join", tip: "Someone opened a shared link and pressed Ask to join. Admins add them in Settings → Members." },
  { id: "run", group: "progress", label: "Run finished", tip: "When every case in a run has a result, or the run is closed: pass and fail counts, regressions and bugs." },
  { id: "rc", group: "progress", label: "Release testing done", tip: "Every test cycle's run of one release is done or closed, like the Release status page." },
  { id: "start", group: "progress", label: "Run started", tip: "Someone starts a new run." },
];

/** Severity choices for "Serious bug filed": this one or worse. */
export const SEV_CHOICES: { id: Severity; label: string }[] = [
  { id: "SHOWSTOPPER", label: "A - Showstopper" },
  { id: "CRITICAL", label: "B - Critical or worse" },
  { id: "PROBLEMATIC", label: "C - Problematic or worse" },
];

const SEV_ORDER: Severity[] = ["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"];
export const atLeast = (s: Severity, threshold: Severity) => SEV_ORDER.indexOf(s) <= SEV_ORDER.indexOf(threshold);

export function parseAlerts(v: unknown): Alerts {
  const r = (v && typeof v === "object" ? v : {}) as Partial<Alerts>;
  const out = { ...DEFAULT_ALERTS };
  for (const a of ALERTS) if (typeof r[a.id] === "boolean") out[a.id] = r[a.id]!;
  if (r.sev && SEV_ORDER.includes(r.sev)) out.sev = r.sev;
  return out;
}

/** "Regression, Serious bug (B or worse), Run finished" for summaries. */
export function alertSummary(a: Alerts) {
  const on = ALERTS.filter((x) => a[x.id]).map((x) => (x.id === "bug" ? `Serious bug (${a.sev === "SHOWSTOPPER" ? "A" : a.sev === "CRITICAL" ? "B or worse" : "C or worse"})` : x.label));
  return on.length ? on.join(", ") : "No alerts on";
}

/** Slack incoming webhook links. Local links are allowed outside production, for testing. */
export function webhookProblem(url: string, production = process.env.NODE_ENV === "production") {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "Paste the whole webhook link from Slack, starting with https://hooks.slack.com/";
  }
  if (u.protocol === "https:" && (u.hostname === "hooks.slack.com" || u.hostname === "hooks.slack-gov.com") && u.pathname.startsWith("/services/")) return null;
  if (!production && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return null;
  return "That isn't a Slack webhook link. It starts with https://hooks.slack.com/services/";
}

/** "#qa-alerts" from "qa-alerts" or "#qa-alerts". */
export const channelName = (name: string) => `#${name.trim().replace(/^#+/, "")}`;

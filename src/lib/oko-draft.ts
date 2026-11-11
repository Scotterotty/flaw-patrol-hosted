// The OKO form (a run's Report a bug) and a bug written with the OKO layout hold the same bug:
// these turn one into the other, so Write a bug shows the very same form and files into
// Jira's own fields (Scott, Nov 10: "the OKO template should be the same wherever it appears").
import type { Answer } from "./bug-layout";
import { FIELD, type History, type TemplateBug } from "./bug-template";

type Draft = { platform: string; area: string; summary: string; answers: Answer[]; fields: { id: string; name: string; value: string[] }[] };

const TEXT: Record<string, keyof TemplateBug> = {
  "issue observed on": "observedOn",
  "clients needed for repro": "clientsNeeded",
  description: "what",
  threads: "slack",
  "repro steps": "reproSteps",
  "bug impact": "impact",
  "bug workaround": "workaround",
  "oko space link": "spaceLink",
  "repro rate": "reproRate",
  "build #": "build",
};

const COLUMN: Record<string, keyof History> = {
  "date & time": "dateTime",
  "client version": "client",
  csp: "csp",
  context: "context",
  "user name & id": "user",
  "env & tenant": "envTenant",
  repros: "repros",
};

const FIELDS: [string, "team" | "clients" | "olyEnv"][] = [
  [FIELD.team, "team"],
  [FIELD.clients, "clients"],
  [FIELD.olyEnv, "olyEnv"],
];

const key = (h: string) => h.trim().toLowerCase();

/** The OKO form's bug, read from a bug written with the OKO layout. */
export function draftToOko(d: Draft): TemplateBug {
  const b: TemplateBug = {
    clientTag: d.platform,
    feature: d.area,
    brief: d.summary,
    observedOn: "",
    clientsNeeded: "",
    what: "",
    slack: "",
    history: { dateTime: "", client: "", csp: "", context: "", user: "", envTenant: "", repros: "" },
    reproSteps: "",
    spaceLink: "",
    impact: "",
    workaround: "",
    reproRate: "",
    build: "",
    clients: [],
    team: "",
    olyEnv: [],
  };
  for (const a of d.answers) {
    const k = TEXT[key(a.heading)];
    if (k) (b as Record<string, unknown>)[k] = a.text;
    else if (a.columns && a.rows?.[0]) a.columns.forEach((c, i) => COLUMN[key(c.name)] && (b.history[COLUMN[key(c.name)]] = a.rows![0][i] ?? ""));
  }
  for (const [name, k] of FIELDS) {
    const v = d.fields.find((f) => f.name === name)?.value ?? [];
    if (k === "team") b.team = v[0] ?? "";
    else b[k] = v.filter(Boolean);
  }
  return b;
}

/** A bug written with the OKO layout, with what was typed in the OKO form put back under its headings. */
export function okoIntoDraft<D extends Draft>(d: D, b: TemplateBug): D {
  const answers = d.answers.map((a) => {
    const k = TEXT[key(a.heading)];
    if (k) return { ...a, text: String(b[k] ?? "") };
    if (a.columns && a.rows?.length) {
      const row = a.columns.map((c, i) => (COLUMN[key(c.name)] ? b.history[COLUMN[key(c.name)]] : (a.rows![0][i] ?? "")));
      return { ...a, rows: [row, ...a.rows.slice(1)] };
    }
    return a;
  });
  const fields = d.fields.map((f) => {
    const k = FIELDS.find(([name]) => name === f.name)?.[1];
    if (!k) return f;
    return { ...f, value: k === "team" ? (b.team ? [b.team] : []) : b[k] };
  });
  return { ...d, platform: b.clientTag, area: b.feature, summary: b.brief, answers, fields };
}

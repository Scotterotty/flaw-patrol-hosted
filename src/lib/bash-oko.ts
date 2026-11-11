// Bug bash bugs in a test cycle whose Jira bugs use the OKO form (ver_220). Jira refuses an
// OKO bug without its 7 fields, so a bash bug keeps the OKO layout like a bash bug template:
// Flaw Patrol fills in Team, Client/SKUs, Build # and OKO Space Link, the finder can add
// Repro steps, Bug impact and Workaround while logging (never required to log), and only a
// bug that has them all goes to Jira at wrap-up. Pure, client-safe.

import { FIELD } from "./bug-template";
import type { Answer, BugLayout } from "./bug-layout";
import { bashAnswers, type BashValues } from "./bash-template";

/** The name a bash bug with the OKO layout shows ("Needs 2 · OKO form"). */
export const OKO_FORM = "OKO form";

/** The three boxes under Add for Jira, by the OKO layout's headings, with the words people see. */
export const ASK_FOR_JIRA = [
  { heading: "Repro steps", label: "Repro steps", hint: "1. …" },
  { heading: "Bug impact", label: "Bug impact", hint: "Who is hurt, how badly" },
  { heading: "Bug workaround", label: "Bug workaround", hint: "None known" },
] as const;

/** What the cycle's bug defaults give every OKO bug: Team and Client/SKUs (Settings → Jira). */
export type OkoDefaults = { team: string; clients: string[] };

const key = (h: string) => h.trim().toLowerCase();
const answerOf = (answers: Answer[], heading: string) => answers.find((a) => key(a.heading) === key(heading));
const fieldOf = (layout: BugLayout, name: string) => layout.fields.find((f) => f.name === name)?.value.filter(Boolean) ?? [];

/** The OKO layout's section id for each Add for Jira box, so the log box sends them under the right heading. */
export function askIds(layout: BugLayout): Record<(typeof ASK_FOR_JIRA)[number]["heading"], string> {
  const id = (h: string) => layout.sections.find((s) => key(s.heading) === key(h))?.id ?? "";
  return { "Repro steps": id("Repro steps"), "Bug impact": id("Bug impact"), "Bug workaround": id("Bug workaround") };
}

/**
 * A new bash bug with the OKO layout: what was typed under its headings, the one line as
 * Description, the bash's build as Build #, Repro rate 1/1 (as in a run), and the cycle's
 * Team and Client/SKUs defaults. Client/SKUs left empty follows the bug's client at wrap-up.
 */
export function okoStart(layout: BugLayout, d: OkoDefaults, input: { values: BashValues; actual: string; build: string; env: string; auto: Parameters<typeof bashAnswers>[3] }) {
  const answers = bashAnswers(layout, input.values, { env: input.env, actual: input.actual }, input.auto).map((a) => {
    if (key(a.heading) === "build #" && !a.text.trim()) return { ...a, text: input.build };
    if (key(a.heading) === "repro rate" && !a.text.trim()) return { ...a, text: "1/1" };
    return a;
  });
  const fields = layout.fields.map((f) => {
    if (f.value.length) return f;
    if (f.name === FIELD.team) return { ...f, value: [d.team].filter(Boolean) };
    if (f.name === FIELD.clients) return { ...f, value: d.clients };
    return f;
  });
  return { layout: { ...layout, fields }, answers };
}

/**
 * What an OKO bash bug still needs before Jira takes it: Jira's required OKO fields that
 * are empty after Flaw Patrol's own filling in. OKO Space Link is never missing (it's N/a),
 * and Client/SKUs follows the bug's client when nobody picked one.
 */
export function okoNeeds(layout: BugLayout, answers: Answer[], platform = "") {
  const words: string[] = [];
  const ids: string[] = [];
  for (const [heading, word] of [
    ["Repro steps", "Repro steps"],
    ["Bug impact", "Bug impact"],
    ["Bug workaround", "Workaround"],
  ] as const) {
    const a = answerOf(answers, heading);
    if (a && !a.text.trim()) {
      words.push(word);
      ids.push(a.id);
    }
  }
  if (!fieldOf(layout, FIELD.team).length) words.push("Team");
  if (!fieldOf(layout, FIELD.clients).length && !platform.trim()) words.push("Client/SKUs");
  const build = answerOf(answers, "Build #");
  if (build && !build.text.trim()) {
    words.push("Build #");
    ids.push(build.id);
  }
  return { words, ids };
}

/** "Filled in for you: Team Web · Client/SKUs Web · Build # 4.21.0 · OKO Space Link N/a" */
export function okoFilled(layout: BugLayout, answers: Answer[], platform = ""): { name: string; value: string }[] {
  const clients = fieldOf(layout, FIELD.clients);
  return [
    { name: "Team", value: fieldOf(layout, FIELD.team).join(", ") },
    { name: "Client/SKUs", value: clients.length ? clients.join(", ") : platform.trim() },
    { name: "Build #", value: answerOf(answers, "Build #")?.text.trim() ?? "" },
    { name: "OKO Space Link", value: answerOf(answers, "OKO Space Link")?.text.trim() || "N/a" },
  ].filter((x) => x.value);
}

/** Not a bug's reasons at wrap-up. Other… takes a typed one. */
export const NOT_A_BUG_REASONS = ["Works as designed", "Can't reproduce", "Duplicate"] as const;
export const CANT_REPRODUCE = "Can't reproduce";

/** "Not a bug · Works as designed", or just "Not a bug". */
export const notABugLine = (reason: string) => (reason.trim() ? `Not a bug · ${reason.trim()}` : "Not a bug");

/** The note Can't reproduce offers to send the finder: "@Sam, we couldn't reproduce this. Can you add steps?" */
export function askFinderNote(finder: string) {
  const first = firstName(finder);
  return `${first ? `@${first}, w` : "W"}e couldn't reproduce this. Can you add steps?`;
}

/** "Sam" from "Sam Lee" or "sam@example.com". */
export const firstName = (name: string) => name.trim().split(/[\s@]/)[0] ?? "";

/** A note that @mentions the finder (Can't reproduce), so it shows on their screen with a box to answer. */
export const isAskOf = (text: string, finder: string) => !!firstName(finder) && text.startsWith(`@${firstName(finder)},`);

/** The OKO layout and the cycle's defaults, when the bash's test cycle files OKO bugs; else null. */
export type BashOko = { layout: BugLayout; defaults: OkoDefaults };

/**
 * A plain bash bug in an OKO cycle (logged before ver_220, or with nothing typed for Jira) seen
 * with the OKO layout: its line as Description and its steps and details as Repro steps.
 * Bugs with a template of their own, filed bugs and other finds stay as they are.
 */
export function withOko<T extends { kind: string; text: string; details: string; build: string; templateName: string; layout: unknown; answers: unknown; defectId?: string | null }>(item: T, oko: BashOko | null): T {
  if (!oko || item.kind !== "bug" || item.templateName || item.defectId) return item;
  const ids = askIds(oko.layout);
  const values: BashValues = item.details.trim() ? { [ids["Repro steps"]]: { text: item.details, files: [] } } : {};
  const t = okoStart(oko.layout, oko.defaults, { values, actual: item.text, build: item.build, env: "", auto: { now: "", build: "", env: "", device: "", who: "" } });
  return { ...item, templateName: OKO_FORM, layout: t.layout, answers: t.answers };
}

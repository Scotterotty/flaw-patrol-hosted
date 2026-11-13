import type { ResultStatus } from "@prisma/client";
import { guessClients } from "./clients";

// Sister cases: a demo dry run case and an RC case that test the same thing, like dry run
// "Log in" and Web "Sign In / Out". A link says which of the RC case's steps the dry run covers.
// When the dry run case (or one of its clients) gets a result, those steps fill in on open RC
// runs, only where nobody has marked them yet. Pure, so the page, the runner and the server share it.

/** What a step is known by in a link: its words, lowercased, so a renumbered step still matches. */
export function stepKey(action: string, expected = ""): string {
  const text = action.trim() || expected.trim();
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

/** One step of a sister case, as the Sister cases page lists it. */
export type SisterStep = { key: string; label: string };

/** A short label for a step: its first line, cut at 90 characters. */
export function stepLabel(action: string, expected = ""): string {
  const line = (action.trim() || expected.trim()).split("\n")[0].trim();
  return line.length > 90 ? `${line.slice(0, 88)}…` : line || "(empty step)";
}

/** A case's steps for the page: one per distinct key, headings left out. */
export function sisterSteps(steps: { action: string; expected: string; heading?: boolean }[]): SisterStep[] {
  const seen = new Set<string>();
  const out: SisterStep[] = [];
  for (const s of steps) {
    if (s.heading) continue;
    const key = stepKey(s.action, s.expected);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: stepLabel(s.action, s.expected) });
  }
  return out;
}

/** The step indexes in a run's copy of a case that a link covers. No keys means every step. */
export function linkedIndexes(steps: { action?: string; expected?: string }[], keys: readonly string[], headings: ReadonlySet<number>): number[] {
  const want = new Set(keys);
  return steps.flatMap((s, i) => (headings.has(i) ? [] : !want.size || want.has(stepKey(s.action ?? "", s.expected ?? "")) ? [i] : []));
}

/** Keys a link has that the case no longer has: the steps were edited, so the link needs a look. */
export function missingKeys(caseSteps: readonly SisterStep[], keys: readonly string[]): string[] {
  const have = new Set(caseSteps.map((s) => s.key));
  return keys.filter((k) => !have.has(k));
}

/** The result that fills sister steps: only a clear Passed, Failed or Blocked carries over. */
export function fillStatus(s: ResultStatus | null | undefined): "PASSED" | "FAILED" | "BLOCKED" | null {
  return s === "PASSED" || s === "FAILED" || s === "BLOCKED" ? s : null;
}

export type Plan = { next: ResultStatus[]; filled: number[]; disagree: number[] };

/**
 * Fill steps `idx` with `status`: only steps nobody has marked. A step already marked the same way
 * is left alone; one marked differently is a disagreement and is never changed.
 */
export function planFill(base: readonly ResultStatus[], idx: readonly number[], status: ResultStatus): Plan {
  const next = [...base];
  const filled: number[] = [];
  const disagree: number[] = [];
  for (const i of idx) {
    if (i >= next.length) continue;
    const now = next[i];
    if (now === "UNTESTED" || now === "IN_PROGRESS") {
      next[i] = status;
      filled.push(i);
    } else if (now !== status) disagree.push(i);
  }
  return { next, filled, disagree };
}

/** A step filled from a dry run, kept on the run's copy of the case. */
export type FillMark = { status: ResultStatus; by: string; byId: string; at: string; from: string; run: string; bugs: string[]; resultId?: string };
/** A dry run result that didn't match what the step already had. */
export type Disagree = { steps: number[]; says: ResultStatus; from: string; run: string; by: string; at: string };
export type SisterFill = { steps: Record<string, FillMark>; disagree: Disagree[]; resultId?: string };

export function parseSisterFill(json: unknown): SisterFill | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Partial<SisterFill>;
  const steps = o.steps && typeof o.steps === "object" ? o.steps : {};
  const disagree = Array.isArray(o.disagree) ? o.disagree : [];
  if (!Object.keys(steps).length && !disagree.length) return null;
  return { steps, disagree, ...(typeof o.resultId === "string" ? { resultId: o.resultId } : {}) };
}

// ───────────── Suggestions ─────────────

// Words that say nothing about what is tested.
const STOP = new Set(
  "a an and are as at be by can do does for from has have in into is it its of on or that the then this to user users with will able ensure validate validates verify check across all other clients client platforms every each new existing space spaces web unreal unity ios ueee remote ipad iphone android mobile desktop in-space hub ui component components test tests case cases feature steps step shared unique make sure properly correctly appear appears visible look looks see sees good great custom model models creator creators settings setting drop drops performance select panel button tool tools open add adds added create creates name names issue issues display displays item items view screen record recording run running window option options".split(
    " ",
  ),
);
// Different words for the same thing in a dry run and an RC case.
const SAME: Record<string, string> = {
  login: "signin", log: "sign", logging: "sign", logged: "sign", signing: "sign", signin: "signin",
  people: "userlist", userlist: "userlist", participants: "userlist",
  voice: "call", microphone: "call", microphones: "call", audio: "call", call: "call",
  webcam: "video", camera: "camera", cine: "cinematic", cinematic: "cinematic",
  ecommerce: "ecommerce", commerce: "ecommerce", shopping: "ecommerce", cart: "ecommerce", bag: "ecommerce", checkout: "ecommerce", shopify: "ecommerce",
  comment: "comment", comments: "comment", annotation: "comment", annotations: "comment",
  splat: "splat", splats: "splat", gaussian: "splat", gsplat: "splat", gsplats: "splat",
  material: "material", materials: "material", pbr: "material",
  script: "script", scripts: "script", scripting: "script",
  hotspot: "hotspot", hotspots: "hotspot", teleport: "hotspot", transport: "hotspot",
  avatar: "avatar", avatars: "avatar",
  anchor: "anchor", anchors: "anchor", anchoring: "anchor",
  map: "map", maps: "map", tile: "map", tiles: "map", satellite: "map",
  chat: "chat", enter: "enter", entering: "enter",
  asset: "asset", assets: "asset", library: "asset", sketchfab: "asset",
  move: "move", moving: "move", scale: "move", rotate: "move", translation: "move",
  text: "text", plugin: "plugin", project: "plugin",
};

function terms(text: string): string[] {
  const t = text.toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/user list/g, "userlist").replace(/\b(log ?in|logging in|sign(?:ing)?\s*in(?!g))/g, " signin ").replace(/\bsign(?:ing)? ?out/g, " signout ").replace(/e-commerce/g, "ecommerce");
  const out: string[] = [];
  for (const w of t.match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3 || STOP.has(w)) continue;
    const base = SAME[w] ?? (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w);
    if (!STOP.has(base)) out.push(base);
  }
  return out;
}

export type SuggestCase = { id: string; title: string; folder?: string; steps: SisterStep[] };
export type Suggestion = { caseId: string; client: string; score: number; steps: string[] };

/**
 * Likely sisters for a dry run case: the library cases whose title shares its words, one per client
 * it covers, picked on the client their title names ("[WEB] - …" is Web). A case naming no client
 * fits any. `clients` empty means the dry run has no clients: the best few overall.
 */
export function suggestSisters(from: { title: string; text: string }, clients: readonly string[], cycleClients: readonly string[], library: readonly SuggestCase[], max = 3): Suggestion[] {
  // The dry run case's title says what it tests; its steps' words count for less.
  const head = new Set(terms(from.title));
  const mine = new Set([...head, ...terms(from.text)]);
  if (!mine.size) return [];
  // Words most cases have (like "space") count for less.
  const df = new Map<string, number>();
  const caseTerms = library.map((c) => new Set(terms(c.title)));
  for (const s of caseTerms) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w: string) => Math.log(1 + library.length / (df.get(w) ?? 1));
  const scored = library
    .map((c, i) => {
      let score = 0;
      let named = 0;
      for (const w of caseTerms[i]) {
        if (!mine.has(w)) continue;
        score += weight(w) * (head.has(w) ? 1 : 0.5);
        if (head.has(w)) named++;
      }
      return { c, score, named };
    })
    // Its title has to share a word with the dry run case's title, not only with its steps.
    .filter((x) => x.named > 0)
    .sort((a, b) => b.score - a.score);
  const stepsFor = (c: SuggestCase) => {
    const hit = c.steps.filter((s) => terms(s.label).some((w) => head.has(w))).map((s) => s.key);
    return hit.length && hit.length < c.steps.length ? hit : [];
  };
  if (!clients.length) return scored.slice(0, max).map(({ c, score }) => ({ caseId: c.id, client: "", score, steps: stepsFor(c) }));
  const out: Suggestion[] = [];
  for (const client of clients) {
    const best = scored.find(({ c }) => {
      const on = guessClients(`${c.title}\n${c.folder ?? ""}`, cycleClients);
      // A case that names no client (the guess is every client) fits any.
      return on.length === cycleClients.length || on.includes(client);
    });
    // The remote user tests on Web too, but its RC case is the Web one: suggest it for Web only.
    if (best && !out.some((o) => o.caseId === best.c.id)) out.push({ caseId: best.c.id, client, score: best.score, steps: stepsFor(best.c) });
  }
  return out;
}

/** "Sign In / Out on Web and Unreal". */
export function filledLine(items: { title: string; where: string }[]): string {
  const parts = items.map((x) => `${x.title} in ${x.where}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

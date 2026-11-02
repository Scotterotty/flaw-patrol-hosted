import { z } from "zod";

// Custom reports: the parts people can pick from the Reports tabs, and what a
// report keeps for each one. Shared by the pages, the editor and the export.

export type PartTab = "status" | "trends" | "steps" | "failing" | "regression" | "defects" | "cases" | "other";

export const PART_TABS: { id: PartTab; label: string }[] = [
  { id: "status", label: "Execution status" },
  { id: "trends", label: "Trends" },
  { id: "steps", label: "Step results" },
  { id: "failing", label: "Failing steps" },
  { id: "regression", label: "Regression" },
  { id: "defects", label: "Bugs found" },
  { id: "cases", label: "Case history" },
  { id: "other", label: "Other tabs" },
];

/** Every part, in the order the Reports tabs show them. `umbrella`: only on an umbrella's Reports. */
export const PARTS = [
  { id: "status.cycles", tab: "status", title: "By test cycle", umbrella: true },
  { id: "status.tiles", tab: "status", title: "Summary numbers" },
  { id: "status.cases", tab: "status", title: "Cases in these runs" },
  { id: "status.passrate", tab: "status", title: "Pass rate by run" },
  { id: "status.suites", tab: "status", title: "Test suites" },
  { id: "status.runs", tab: "status", title: "Runs" },
  { id: "trends.passrate", tab: "trends", title: "Pass rate over time" },
  { id: "trends.results", tab: "trends", title: "Results over time" },
  { id: "trends.bugs", tab: "trends", title: "Bugs found over time" },
  { id: "trends.releases", tab: "trends", title: "By release" },
  { id: "steps.tiles", tab: "steps", title: "Step numbers" },
  { id: "steps.outcomes", tab: "steps", title: "Step outcomes" },
  { id: "steps.byrun", tab: "steps", title: "Steps by run" },
  { id: "steps.failmost", tab: "steps", title: "Steps that fail most" },
  { id: "failing.tiles", tab: "failing", title: "Failing step numbers" },
  { id: "failing.history", tab: "failing", title: "Failure history by step" },
  { id: "regression", tab: "regression", title: "Regression list" },
  { id: "defects.tiles", tab: "defects", title: "Bug numbers" },
  { id: "defects.list", tab: "defects", title: "Bug list" },
  { id: "cases.failing", tab: "cases", title: "Failing now" },
  { id: "cases.flaky", tab: "cases", title: "Flaky" },
  { id: "cases.all", tab: "cases", title: "Every case executed" },
  { id: "rc", tab: "other", title: "Release status summary" },
  { id: "requirements", tab: "other", title: "Requirements coverage" },
  { id: "wrapups", tab: "other", title: "Bug bash and exploring wrap-ups" },
] as const satisfies readonly { id: string; tab: PartTab; title: string; umbrella?: boolean }[];

export type PartId = (typeof PARTS)[number]["id"];
export const isPartId = (v: unknown): v is PartId => PARTS.some((p) => p.id === v);
export const partOf = (id: PartId) => PARTS.find((p) => p.id === id)!;
export const tabLabel = (t: PartTab) => PART_TABS.find((x) => x.id === t)!.label;
/** The parts a report on this page can hold. */
export const partsFor = (umbrella: boolean) => PARTS.filter((p) => umbrella || !("umbrella" in p && p.umbrella));

/** A part's own filters ("Use its own filters"): another release, all time, or critical bugs only. */
const ownSchema = z.object({ release: z.string().trim().max(80).optional(), allTime: z.boolean().optional(), critical: z.boolean().optional() }).strict();
export type OwnFilters = z.infer<typeof ownSchema>;

const itemSchema = z.discriminatedUnion("k", [
  z.object({
    k: z.literal("part"),
    id: z.string().min(1).max(40),
    part: z.string().refine(isPartId),
    heading: z.string().trim().max(120).optional(),
    /** Show next to the part after it. */
    side: z.boolean().optional(),
    /** Start on a new page in the PDF. */
    pb: z.boolean().optional(),
    own: ownSchema.optional(),
  }),
  z.object({ k: z.literal("note"), id: z.string().min(1).max(40), text: z.string().max(4000), pb: z.boolean().optional() }),
]);
export const itemsSchema = z.array(itemSchema).max(60);
export type ReportPart = { k: "part"; id: string; part: PartId; heading?: string; side?: boolean; pb?: boolean; own?: OwnFilters };
export type ReportNote = { k: "note"; id: string; text: string; pb?: boolean };
export type ReportItem = ReportPart | ReportNote;

/** A report's stored parts, dropping anything this version doesn't know. */
export function parseItems(v: unknown): ReportItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const r = itemSchema.safeParse(x);
    return r.success ? [r.data as ReportItem] : [];
  });
}

/** The People part was taken out: reports never compare people. True if a stored report still lists it. */
export const hadPeoplePart = (v: unknown) => Array.isArray(v) && v.some((x) => x && typeof x === "object" && (x as { part?: unknown }).part === "testers");

export const newItemId = () => Math.random().toString(36).slice(2, 10);

/** The heading a part shows: the one people typed, else its own. */
export const headingOf = (it: ReportPart) => it.heading || partOf(it.part).title;

/** The own filters in words, for the little tag on the part. */
export function ownLabel(own: OwnFilters | undefined) {
  if (!own) return null;
  const bits = [own.release, own.allTime && "All time", own.critical && "Critical only"].filter(Boolean);
  return bits.length ? `Own filters: ${bits.join(", ")}` : null;
}

/**
 * Parts in the order they show, with "side by side" parts paired with the part after them.
 * A note is kept with the part after it, so the PDF never leaves a note at the foot of a page.
 */
export function layoutRows(items: ReportItem[]): ReportItem[][] {
  const rows: ReportItem[][] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const next = items[i + 1];
    if (it.k === "part" && it.side && next?.k === "part") {
      rows.push([it, next]);
      i++;
    } else rows.push([it]);
  }
  return rows;
}

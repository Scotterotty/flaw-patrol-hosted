// The context a bug report starts from: the run entry, its steps and the run's details (ver_119
// moved it here from server/jira.ts so bug templates use the same one). Server only.

import { runTitle } from "./run-label";
import { parsePlanValues, valuesLabel } from "./configurations";
import { headers } from "next/headers";
import { missionLine, parseCharter } from "@/lib/charter";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import type { BugContext } from "@/lib/jira-format";
import { pickValues } from "@/lib/run-fields";
import { runFieldsFor } from "@/lib/run-fields-server";
import { stepsToRun, type ExpandedStep } from "@/lib/steps";
import { parseTestData, rowLabel, rowSummary } from "@/lib/test-data";
import { parsePlatforms } from "@/lib/umbrella";
import { UserError } from "@/server/result";

const findEntry = (projectId: string, entryId: string) =>
  db.runEntry.findFirst({
    where: { id: entryId, run: { projectId } },
    include: { run: { include: { project: true } }, testCase: { select: { number: true, tags: true, project: { select: { key: true, groupId: true, hubOf: { select: { platforms: true } } } } } } },
  });
type Entry = NonNullable<Awaited<ReturnType<typeof findEntry>>>;

/**
 * Write a bug: no entry id means a bug written on its own, not from a test.
 * It has no case, steps or run, so everything a run would fill starts blank; the
 * release comes from the test cycle, and the link points at the Bugs page.
 */
async function writtenContext(projectId: string, actual: string) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new UserError("That test cycle isn't here anymore.");
  const run = { id: "", number: 0, name: "", build: "", release: "", environment: "", cspVersion: "", project };
  const entry = { id: "", title: "", kind: "MANUAL", steps: [], testData: null, preconditions: "", charter: null, run, testCase: { number: 0, tags: [], project: { key: project.key, groupId: project.groupId, hubOf: null } } } as unknown as Entry;
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `https://${h.get("host")}` : null);
  const ctx: BugContext = { caseKey: "", caseTitle: "", runLabel: "", build: "", environment: "", preconditions: "", steps: [], failedIndex: null, actual, link: origin ? `${origin}/p/${project.key}/bugs` : null, titleTags: [] };
  return { ctx, entry };
}

/** Build the context for a bug report from a run entry. */
/**
 * focus (persona audit #4): a whole-case bug written from the first failed step, so
 * its summary and steps start from what failed. The bug still belongs to the whole case.
 */
export async function bugContext(projectId: string, entryId: string, stepIndex: number | null, actual: string, focus: number | null = null) {
  if (!entryId) return writtenContext(projectId, actual);
  const entry = await findEntry(projectId, entryId);
  if (!entry) throw new UserError("This case is no longer in the run.");
  // Bracket tags: platform tags and ALL-CAPS ones like ANDROID go back in front of the bug's title.
  const platformNames = parsePlatforms(entry.testCase.project.hubOf?.platforms).map((p) => p.name.toLowerCase());
  const titleTags = entry.testCase.tags.filter((t) => platformNames.includes(t.toLowerCase()) || (/[A-Z]/.test(t) && t === t.toUpperCase()));
  const saved = (Array.isArray(entry.steps) ? entry.steps : []) as unknown as ExpandedStep[];
  // A case with only a title runs as one step (its title), so a bug can point at it.
  const steps = entry.kind === "EXPLORATORY" ? saved : stepsToRun(saved, entry.title);
  if (stepIndex !== null && !steps[stepIndex]) throw new UserError("That step no longer exists.");
  const at = stepIndex ?? (focus !== null && steps[focus] ? focus : null);
  // Test data: the bug shows only the failing row's steps, and names that row's values.
  const data = parseTestData(entry.testData);
  const row = data && steps.some((s) => s.row !== undefined) ? (at !== null ? (steps[at]?.row ?? 0) : 0) : null;
  const shown = row === null ? steps : steps.filter((s) => s.row === row);
  const failedIndex = at === null ? null : row === null ? at : shown.indexOf(steps[at]);
  const testRow = data && row !== null ? `Test data row ${row + 1} of ${data.rows.length}: ${rowSummary(data, row)}` : undefined;
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `https://${h.get("host")}` : null);
  const key = entry.run.project.key;
  const ctx: BugContext = {
    caseKey: caseKey(entry.testCase.project.key, entry.testCase.number),
    caseTitle: entry.title,
    runLabel: `run "${runTitle(entry.run)}"`,
    build: entry.run.build,
    release: entry.run.release,
    cspVersion: entry.run.cspVersion,
    fields: pickValues(entry.run, await runFieldsFor(projectId), "jira"),
    environment: entry.run.environment,
    // A session's bug carries the charter, since there are no steps to point at.
    preconditions:
      entry.kind === "EXPLORATORY" ? [`Charter: ${missionLine(parseCharter(entry.charter))}`, entry.preconditions].filter(Boolean).join("\n") : entry.preconditions,
    steps: shown.map((s) => ({ number: s.number, action: s.action, expected: s.expected })),
    failedIndex: failedIndex !== null && failedIndex >= 0 ? failedIndex : null,
    testRow,
    rowName: data && row !== null ? rowLabel(data, row) : undefined,
    actual,
    link: origin ? `${origin}/p/${key}/runs/${entry.run.number}/execute?entry=${entry.id}` : null,
    titleTags,
    planTag: valuesLabel(parsePlanValues(entry.run.planValues)) || undefined,
  };
  return { ctx, entry };
}


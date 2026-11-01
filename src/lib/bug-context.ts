// The context a bug report starts from: the run entry, its steps and the run's details (ver_119
// moved it here from server/jira.ts so bug templates use the same one). Server only.

import { headers } from "next/headers";
import { missionLine, parseCharter } from "@/lib/charter";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import type { BugContext } from "@/lib/jira-format";
import { pickValues } from "@/lib/run-fields";
import { runFieldsFor } from "@/lib/run-fields-server";
import type { ExpandedStep } from "@/lib/steps";
import { parsePlatforms } from "@/lib/umbrella";
import { UserError } from "@/server/result";

/** Build the context for a bug report from a run entry. */
/**
 * focus (ver_124, persona audit #4): a whole-case bug written from the first failed step, so
 * its summary and steps start from what failed. The bug still belongs to the whole case.
 */
export async function bugContext(projectId: string, entryId: string, stepIndex: number | null, actual: string, focus: number | null = null) {
  const entry = await db.runEntry.findFirst({
    where: { id: entryId, run: { projectId } },
    include: { run: { include: { project: true } }, testCase: { select: { number: true, tags: true, project: { select: { key: true, groupId: true, hubOf: { select: { platforms: true } } } } } } },
  });
  if (!entry) throw new UserError("This case is no longer in the run.");
  // Bracket tags (ver_96): platform tags and ALL-CAPS ones like ANDROID go back in front of the bug's title.
  const platformNames = parsePlatforms(entry.testCase.project.hubOf?.platforms).map((p) => p.name.toLowerCase());
  const titleTags = entry.testCase.tags.filter((t) => platformNames.includes(t.toLowerCase()) || (/[A-Z]/.test(t) && t === t.toUpperCase()));
  const steps = (Array.isArray(entry.steps) ? entry.steps : []) as unknown as ExpandedStep[];
  if (stepIndex !== null && !steps[stepIndex]) throw new UserError("That step no longer exists.");
  const failedIndex = stepIndex ?? (focus !== null && steps[focus] ? focus : null);
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `https://${h.get("host")}` : null);
  const key = entry.run.project.key;
  const ctx: BugContext = {
    caseKey: caseKey(entry.testCase.project.key, entry.testCase.number),
    caseTitle: entry.title,
    runLabel: `run R${entry.run.number} "${entry.run.name}"`,
    build: entry.run.build,
    release: entry.run.release,
    cspVersion: entry.run.cspVersion,
    fields: pickValues(entry.run, await runFieldsFor(projectId), "jira"),
    environment: entry.run.environment,
    // A session's bug carries the charter, since there are no steps to point at.
    preconditions:
      entry.kind === "EXPLORATORY" ? [`Charter: ${missionLine(parseCharter(entry.charter))}`, entry.preconditions].filter(Boolean).join("\n") : entry.preconditions,
    steps: steps.map((s) => ({ number: s.number, action: s.action, expected: s.expected })),
    failedIndex,
    actual,
    link: origin ? `${origin}/p/${key}/runs/${entry.run.number}/execute?entry=${entry.id}` : null,
    titleTags,
  };
  return { ctx, entry };
}


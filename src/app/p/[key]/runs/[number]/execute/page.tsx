import { runTag, runTitle } from "@/lib/run-label";
import { rowsOfResult } from "@/lib/test-data-history";
import { RunName } from "@/components/run-name";
import { PaneResizer } from "@/components/pane-resizer";
import { parseTestData } from "@/lib/test-data";
import { titleWithTags } from "@/lib/tags";
import { tagColorsFor } from "@/lib/tag-data";
import { TagPills } from "@/components/tag-pill";
import { sentryConnected } from "@/lib/sentry-config";
import { headingRows } from "@/lib/step-checks";
import { startTiming } from "@/lib/timing";
import { CrumbName } from "@/components/crumb-name";
import { fieldBits } from "@/lib/run-fields";
import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { AutomatedBadge, FlakyBadge, PriorityBadge } from "@/components/badges";
import { CaseSortToggle } from "@/components/case-sort-toggle";
import { sortCases } from "@/lib/case-sort";
import { readCaseSort } from "@/lib/case-sort-server";
import { notFound, redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { LiveRefresh } from "@/components/live-refresh";
import { LiveEntryProgress, LiveStatusLabel, LiveStatusPip } from "@/components/run-entries";
import { liveRowOf } from "@/lib/live-rows-data";
import { FlagIcon } from "@/components/case-flag";
import { Runner } from "@/components/runner";
import { RunListFold } from "@/components/runner-case-list";
import { SessionRunner } from "@/components/session-runner";
import { parseCharter, parsePersona, parseSessionLog } from "@/lib/charter";
import { RunnerCaseList } from "@/components/runner-case-list";
import { flakyCases } from "@/lib/flaky";
import { RunnerHistory } from "@/components/runner-history";
import { caseNewsForRun } from "@/lib/case-news-data";
import { shortDate } from "@/lib/spelling";
import { TakeCase } from "@/components/take-case";
import { countStatuses, isOpen, pct, STATUS_LABEL, totals } from "@/lib/status";
import { cx } from "@/components/ui";
import { db } from "@/lib/db";
import { parseDraft } from "@/lib/run-draft";
import { flagInfo, flagLabel } from "@/lib/case-flag";
import { caseKey, relativeTime } from "@/lib/format";
import { isFlaky, type HistoryRun } from "@/lib/run-history";
import { projectAccess, mySpelling } from "@/lib/session";
import { projectMembers } from "@/lib/suite-data";
import { stepsToRun, type ExpandedStep } from "@/lib/steps";
import { jiraConfigFor } from "@/lib/umbrella";
import { DEFAULT_STORIES, parseStoriesConfig, storyInfo } from "@/lib/stories";
import { can } from "@/lib/permissions";
import { entryComparison } from "@/lib/regression-data";
import { againstLabel } from "@/lib/regression";
import { knownBugsForRun } from "@/lib/known-bugs";

export const metadata = { title: "Testing" };

export default async function ExecutePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; number: string }>;
  searchParams: Promise<{ entry?: string; mine?: string; only?: string; finished?: string }>;
}) {
  // FP_TIMING=1 prints how long each part took. Lookups that don't need each other run side by
  // side instead of one after another, so Save and next opens the next case sooner.
  const timing = startTiming("Runner");
  // Live rows read after this replace the list's rows straight away.
  const renderedAt = Date.now();
  const { key, number } = await params;
  const sp = await searchParams;
  const [spelling, { project, user, who }] = await Promise.all([mySpelling(), timing.step("sign-in and project", projectAccess(key))]);
  const [tagColors, run, sort, jira, members, sentryOn] = await Promise.all([
    timing.step("tags", tagColorsFor(project.id)),
    timing.step("run and its cases", db.testRun.findUnique({
    where: { projectId_number: { projectId: project.id, number: Number(number) || 0 } },
    include: { entries: { orderBy: { position: "asc" }, select: { id: true, caseId: true, kind: true, title: true, status: true, priority: true, assigneeId: true, steps: true, draft: true, draftAt: true, draftByName: true, draftById: true, results: { orderBy: { createdAt: "desc" }, take: 1, select: { stepResults: true, testerName: true, testerId: true, createdAt: true } }, testCase: { select: { number: true, flag: true, tags: true, project: { select: { key: true } } } } } } },
    })),
    readCaseSort(),
    timing.step("Jira", jiraConfigFor(project.id)),
    timing.step("members", projectMembers(project.id)),
    timing.step("Sentry", sentryConnected(project.id)),
  ]);
  if (!run) notFound();
  if (!run.entries.length) redirect(`/p/${project.key}/runs/${run.number}`);

  // Sorting by priority also changes which case comes next.
  run.entries = sortCases(run.entries, sort, (e) => e.priority, (e) => e.status);
  // ?only=3,5,9 runs just those cases (picked on the run page); ?mine=1 just mine.
  const onlyNumbers = new Set((sp.only ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));
  const selection = onlyNumbers.size ? run.entries.filter((e) => onlyNumbers.has(e.testCase.number)) : null;
  const mineOnly = !selection && sp.mine === "1";
  const list = selection ?? (mineOnly ? run.entries.filter((e) => e.assigneeId === user.id) : run.entries);
  const keep = selection ? `&only=${selection.map((e) => e.testCase.number).join(",")}` : mineOnly ? "&mine=1" : "";
  // Default to a case of mine that's half done, then the first untested case assigned to me, then any untested case.
  // When running a selection, start at its first unfinished case.
  const pool = selection ?? run.entries;
  const pick =
    pool.find((e) => e.id === sp.entry) ??
    (selection
      ? (selection.find((e) => isOpen(e.status)) ?? selection[0])
      : (run.entries.find((e) => e.status === "IN_PROGRESS" && e.assigneeId === user.id) ??
        run.entries.find((e) => e.status === "UNTESTED" && e.assigneeId === user.id) ??
        run.entries.find((e) => e.status === "UNTESTED") ??
        run.entries[0]));
  if (pick.id !== sp.entry) redirect(`/p/${project.key}/runs/${run.number}/execute?entry=${pick.id}${keep}`);

  const idx = list.findIndex((e) => e.id === pick.id);
  const after = [...list.slice(idx + 1), ...list.slice(0, Math.max(idx, 0))];
  // A selection goes through the picked cases in order, finished ones included, since they were chosen on purpose.
  const next = selection
    ? (list[idx + 1] ?? null)
    : (after.find((e) => e.status === "UNTESTED" && (!e.assigneeId || e.assigneeId === user.id)) ?? after.find((e) => e.status === "UNTESTED") ?? null);

  const entryP = timing.step("this case", db.runEntry.findUniqueOrThrow({ where: { id: pick.id }, include: { testCase: { select: { id: true, number: true, tags: true, flag: true, flagNote: true, flaggedBy: true, flaggedAt: true, flagRunNumber: true, jiraStories: true, project: { select: { key: true } } } } } }));
  const [entry, last, runLinks, flakyIds, news, storyMap, cmp, past, knownBugs] = await Promise.all([
    entryP,
    timing.step("last result", db.testResult.findFirst({
      where: { entryId: pick.id },
      orderBy: { createdAt: "desc" },
      include: { defects: { include: { defect: true } }, attachments: { orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, size: true, stepIndex: true } } },
    })),
    timing.step("bugs filed", db.defectLink.findMany({ where: { result: { runId: run.id } }, include: { defect: true }, orderBy: { defect: { createdAt: "desc" } } })),
    timing.step("flaky cases", flakyCases({ caseIds: [...new Set(list.map((e) => e.caseId))] })),
    // New or Updated since its last run.
    timing.step("new or updated", entryP.then(async (e) => (await caseNewsForRun(run, [e])).get(e.id) ?? null)),
    // The case's Jira stories, for the runner's chip and the bug box's "Link to story" ticks.
    timing.step("Jira stories", entryP.then((e) => (jira && e.testCase.jiraStories.length ? storyInfo(project.id, e.testCase.jiraStories) : null))),
    // Regression flag: the earlier release this case passed in, so a failed step there gets a note.
    timing.step("regression", pick.kind === "EXPLORATORY" ? Promise.resolve(null) : entryComparison(project, pick.id)),
    timing.step("history", db.testResult.findMany({
      where: { caseId: pick.caseId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        run: { select: { number: true, name: true, release: true, build: true, createdAt: true, cspVersion: true, fields: true, environment: true } },
        entry: { select: { steps: true, title: true } },
        defects: { include: { defect: true } },
        attachments: { select: { id: true, fileName: true } },
      },
    })),
    timing.step("known bugs", knownBugsForRun(run.id, [{ id: pick.id, caseId: pick.caseId, steps: pick.steps }]).then((m) => m.get(pick.id) ?? [])),
  ]);
  timing.done();
  const stories = entry.testCase.jiraStories.map((k) => {
    const i = storyMap?.get(k);
    return { key: k, title: i?.title ?? "", status: i?.status ?? "", url: i?.url ?? null };
  });
  const linkStories = (parseStoriesConfig(jira?.stories) ?? DEFAULT_STORIES).linkBugs;
  const regression = cmp
    ? {
        label: againstLabel(cmp.against),
        when: `${cmp.against.at.toLocaleDateString(spelling === "uk" ? "en-GB" : "en-US", { month: "short", day: "numeric" })}${cmp.against.tester ? `, tested by ${cmp.against.tester}` : ""}`,
        passed: cmp.against.stepStatuses.map((s) => s === "PASSED"),
        resultId: cmp.against.id,
        off: cmp.off,
        jiraLabel: cmp.settings.label,
      }
    : null;
  const history: HistoryRun[] = past.map((r) => {
    const snapshot = stepsToRun((Array.isArray(r.entry.steps) ? r.entry.steps : []) as unknown as ExpandedStep[], r.entry.title);
    const stepResults = (Array.isArray(r.stepResults) ? r.stepResults : []) as { status: ResultStatus; actual?: string }[];
    const headings = headingRows(r.entry.steps);
    return {
      id: r.id,
      ago: relativeTime(r.createdAt, spelling),
      at: r.createdAt.toISOString(),
      entryId: r.entryId,
      runNumber: r.run.number,
      runName: r.automated ? `🤖 ${r.run.name}` : r.run.name,
      runTag: runTag(r.run, spelling),
      meta: [r.run.release && `Release ${r.run.release}`, ...fieldBits(r.run), r.run.environment, `case v${r.caseVersion}`].filter(Boolean).join(" · "),
      status: r.status,
      comment: r.comment,
      testerName: r.testerName,
      caseVersion: r.caseVersion,
      rows: rowsOfResult(r.entry.steps, r.stepResults),
      steps: stepResults.map((sr, i) => ({ number: snapshot[i]?.row !== undefined ? `R${snapshot[i].row! + 1} · ${snapshot[i].number}` : (snapshot[i]?.number ?? String(i + 1)), action: snapshot[i]?.action ?? "", status: sr.status, actual: sr.actual ?? "", ...(headings.has(i) ? { heading: true } : {}) })),
      defects: r.defects.map((l) => ({
        stepIndex: l.stepIndex,
        defect: { id: l.defect.id, number: l.defect.number, title: l.defect.title, externalKey: l.defect.externalKey, externalUrl: l.defect.externalUrl, status: l.defect.externalStatus ?? l.defect.status },
      })),
      attachments: r.attachments,
    };
  });
  const lastPass = past.find((r) => r.status === "PASSED");
  const historySummary = {
    passRate: pct(totals(countStatuses(past.map((r) => r.status))).passRate),
    lastPassed: lastPass ? relativeTime(lastPass.createdAt, spelling) : null,
    flaky: isFlaky(past.map((r) => r.status)),
  };
  const people = new Map(members.map((m) => [m.id, m]));
  const runDefects = [...new Map(runLinks.map((l) => [l.defectId, l.defect])).values()].map((d) => ({
    id: d.id,
    number: d.number,
    title: d.title,
    externalKey: d.externalKey,
    externalUrl: d.externalUrl,
    status: d.externalStatus ?? d.status,
  }));
  const done = run.entries.filter((e) => !isOpen(e.status)).length;

  // Above the case title, inside the part that scrolls, so it never covers Flag or the timer.
  const take = {
    projectId: project.id,
    entryId: entry.id,
    assignee: entry.assigneeId ? (people.get(entry.assigneeId) ?? { id: entry.assigneeId, name: "Someone" }) : null,
    me: user.id,
    closed: run.state === "COMPLETED",
  };
  const takeBar = <TakeCase {...take} session={!!entry.charter} />;
  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-5 lg:flex-row bigtext:flex-col">
      <LiveRefresh url={`/api/live/runs/${run.id}`} rows renderedAt={renderedAt} />
      <CrumbName href={`/p/${project.key}/runs/${run.number}`} label={runTitle(run, spelling)} />
      <aside className="lg:w-80 lg:shrink-0 xl:w-96 2xl:w-[28rem] bigtext:w-auto">
        <div className="flex flex-col gap-3 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] bigtext:static bigtext:max-h-none">
          <RunListFold done={selection ? selection.filter((e) => !isOpen(e.status)).length : done} total={selection ? selection.length : run.entries.length}>
          <div className="shrink-0 rounded-lg border border-slate-200 bg-surface shadow-sm">
            <div className="border-b border-slate-200 p-3">
              <Link href={`/p/${project.key}/runs/${run.number}`} className="text-sm font-semibold text-slate-900 hover:underline">
                <RunName run={run} spelling={spelling} />
              </Link>
              <p className="text-xs text-slate-500">
                {selection
                  ? `${selection.filter((e) => !isOpen(e.status)).length} of ${selection.length} selected tested`
                  : `${done} of ${run.entries.length} tested`}
                {run.release && ` · ${run.release}`}
                {run.build && ` · build ${run.build}`}
                {fieldBits(run).map((b) => ` · ${b}`).join("")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <Link href={`?entry=${pick.id}`} className={cx(!mineOnly && !selection ? "font-medium text-accent-700" : "text-slate-500 hover:underline")}>
                  All cases
                </Link>
                <Link href={`?entry=${pick.id}&mine=1`} className={cx(mineOnly ? "font-medium text-accent-700" : "text-slate-500 hover:underline")}>
                  Assigned to me
                </Link>
                {selection && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-800">
                    Selected ({selection.length})
                    <Link href={`?entry=${pick.id}`} aria-label="Stop running only the selected cases" title="Show all cases" className="text-accent-600 hover:text-accent-900">
                      ×
                    </Link>
                  </span>
                )}
                <CaseSortToggle value={sort} orderLabel="Run order" className="ml-auto h-7" statuses />
              </div>
            </div>
            <RunnerCaseList
              empty="Nothing assigned to you."
              tuckDone={mineOnly}
              items={list.map((e) => ({
                id: e.id,
                done: !isOpen(e.status),
                current: e.id === pick.id,
                text: `${caseKey(e.testCase.project.key, e.testCase.number)} ${e.title} ${e.testCase.tags.join(" ")}`,
                row: (
                  <Link
                    href={`?entry=${e.id}${keep}`}
                    aria-current={e.id === pick.id ? "true" : undefined}
                    className={cx(
                      "flex items-start gap-2.5 border-l-2 px-3 py-2 text-sm",
                      e.id === pick.id ? "border-accent-600 bg-accent-50 text-accent-900" : "border-transparent text-slate-800 hover:bg-slate-50",
                    )}
                    title={`${e.title} · ${STATUS_LABEL[e.status as ResultStatus]}`}
                  >
                    <LiveStatusPip id={e.id} status={e.status} renderedAt={renderedAt} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 leading-snug font-medium">
                        <TagPills tags={titleWithTags(e.title, e.testCase.tags).tags} colors={tagColors} /> {titleWithTags(e.title).title}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">{caseKey(e.testCase.project.key, e.testCase.number)}</span>
                        <PriorityBadge priority={e.priority} />
                        <LiveStatusLabel id={e.id} status={e.status} renderedAt={renderedAt} />
                        {flakyIds.has(e.caseId) && <FlakyBadge flips={flakyIds.get(e.caseId)!} compact />}
                        {e.kind === "AUTOMATED" && !run.automated && <AutomatedBadge />}
                        {e.testCase.flag && (
                          <span title={`Flagged: ${flagLabel(e.testCase.flag)}`} className="text-orange-500">
                            <FlagIcon className="size-3.5" />
                          </span>
                        )}
                      </span>
                      <LiveEntryProgress row={liveRowOf(e, user.id)} current={e.id === pick.id} renderedAt={renderedAt} />
                    </span>
                    {e.assigneeId && people.has(e.assigneeId) && <Avatar person={people.get(e.assigneeId)!} size={20} />}
                  </Link>
                ),
              }))}
            />
          </div>
          <RunnerHistory key={entry.id} olderNote={news?.kind === "updated" ? `Runs before ${shortDate(new Date(news.at), spelling)} used the older steps.` : undefined} runs={history} summary={historySummary} projectKey={project.key} canApply={run.state !== "COMPLETED" && entry.kind !== "EXPLORATORY"} />
          </RunListFold>
        </div>
      </aside>
      <PaneResizer id="run-cases" label="the case list" min={240} max={0.6} className="-mx-4" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:sticky lg:top-16 lg:h-[calc(100vh-6rem)] bigtext:static bigtext:h-auto">
        {entry.kind === "EXPLORATORY" ? (
          <SessionRunner
            key={entry.id + (last?.id ?? "")}
            projectId={project.id}
            projectKey={project.key}
            runNumber={run.number}
            runClosed={run.state === "COMPLETED"}
            jiraConnected={!!jira}
            runDefects={runDefects}
            nextEntryId={next?.id ?? null}
            keepQuery={keep}
            take={take}
            entry={{
              id: entry.id,
              caseKey: caseKey(entry.testCase.project.key, entry.testCase.number),
              caseNumber: entry.testCase.number,
              caseProjectKey: entry.testCase.project.key,
              caseId: entry.testCase.id,
              flag: flagInfo(entry.testCase, relativeTime),
              caseVersion: entry.caseVersion,
              title: entry.title,
              preconditions: entry.preconditions,
              charter: parseCharter(entry.charter),
              persona: parsePersona(entry.persona),
              status: entry.status,
              draft: parseDraft(entry.draft),
              draftBy: entry.draftAt ? { name: entry.draftByName, ago: relativeTime(entry.draftAt, spelling), mine: entry.draftById ? entry.draftById === user.id : entry.draftByName === (user.name ?? user.email) } : null,
            }}
            previous={
              last
                ? { status: last.status, testerName: last.testerName, createdAt: last.createdAt.toISOString(), comment: last.comment, elapsedSec: last.elapsedSec, notes: parseSessionLog(last.sessionLog) }
                : null
            }
          />
        ) : (
          <Runner
          key={entry.id + (last?.id ?? "")}
          canCloseRun={can(who, "run:manage")}
          justFinished={sp.finished === "1" && run.state === "ACTIVE" ? run.id : null}
          regression={regression}
          sentryOn={sentryOn}
          projectId={project.id}
          projectKey={project.key}
          runNumber={run.number}
          runClosed={run.state === "COMPLETED"}
          jiraConnected={!!jira}
          runDefects={runDefects}
          nextEntryId={next?.id ?? null}
          keepQuery={keep}
          takeBar={takeBar}
          tagColors={tagColors}
          news={news}
          newsHref={news?.kind === "updated" ? `/p/${entry.testCase.project.key}/cases/${entry.testCase.number}/versions/${news.version}?from=${news.since.version}` : undefined}
          knownBugs={knownBugs}
          entry={{
            id: entry.id,
            caseKey: caseKey(entry.testCase.project.key, entry.testCase.number),
            caseNumber: entry.testCase.number,
            caseProjectKey: entry.testCase.project.key,
            caseId: entry.testCase.id,
            flag: flagInfo(entry.testCase, relativeTime),
            caseVersion: entry.caseVersion,
            ...titleWithTags(entry.title, entry.testCase.tags),
            preconditions: entry.preconditions,
            folderPath: entry.folderPath,
            steps: stepsToRun((Array.isArray(entry.steps) ? entry.steps : []) as unknown as ExpandedStep[], titleWithTags(entry.title, entry.testCase.tags).title),
            testData: parseTestData(entry.testData),
            status: entry.status,
            draft: parseDraft(entry.draft),
            stories,
            linkStories,
            draftBy: entry.draftAt ? { name: entry.draftByName, ago: relativeTime(entry.draftAt, spelling), at: entry.draftAt.toISOString(), mine: entry.draftById ? entry.draftById === user.id : entry.draftByName === (user.name ?? user.email) } : null,
          }}
          previous={
            last
              ? {
                  status: last.status,
                  testerName: last.testerName,
                  createdAt: last.createdAt.toISOString(),
                  comment: last.comment,
                  stepStatuses: ((last.stepResults as { status: ResultStatus }[]) ?? []).map((s) => s.status),
                  defects: last.defects.map((l) => ({ key: l.defect.externalKey ?? `D-${l.defect.number}`, url: l.defect.externalUrl, title: l.defect.title })),
                  stepResults: ((Array.isArray(last.stepResults) ? last.stepResults : []) as { status: ResultStatus; actual?: string; checks?: ResultStatus[] }[]).map((r) => ({
                    status: r.status,
                    actual: r.actual ?? "",
                    ...(Array.isArray(r.checks) ? { checks: r.checks } : {}),
                  })),
                  attachments: last.attachments,
                  links: last.defects.map((l) => ({
                    stepIndex: l.stepIndex,
                    defect: { id: l.defect.id, number: l.defect.number, title: l.defect.title, externalKey: l.defect.externalKey, externalUrl: l.defect.externalUrl, status: l.defect.externalStatus ?? l.defect.status },
                  })),
                }
              : null
          }
          />
        )}
      </div>
    </div>
  );
}

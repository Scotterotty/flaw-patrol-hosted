"use client";

import { TagPills } from "./tag-pill";
import type { TagColors } from "@/lib/tags";
import { dateTime } from "@/lib/spelling";
import { useSpelling, useZone } from "@/components/spelling";
import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CaseFlagInfo } from "@/lib/case-flag";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { holdLive } from "@/lib/live-hold";
import { publishLiveSteps } from "@/lib/live-steps";
import type { Draft } from "@/lib/run-draft";
import { mapHistorySteps, SHOW_HISTORY_EVENT, STILL_OCCURS_EVENT, type HistoryRun } from "@/lib/run-history";
import { relativeTime } from "@/lib/format";
import { deriveCaseStatus, SETTABLE, STATUS_HELP, STATUS_LABEL, STATUS_STYLE } from "@/lib/status";
import { fillChecks, firstOfShared, readSteps, rollUp, withoutHeadings } from "@/lib/step-checks";
import { stepLabel as labelOfStep, type ExpandedStep } from "@/lib/steps";
import { rowLabel, rowResults, rowsLine, type TestData } from "@/lib/test-data";
import type { LinkedDefect } from "@/server/jira";
import { saveDraft, submitResult, uploadAttachment } from "@/server/results";
import { showQuestMoments } from "./quest-toast";
import { BugDialog } from "./bug-dialog";
import { CaseFlagButton } from "./case-flag";
import { StepText } from "./step-text";
import { StatusChip, StatusIcon } from "./status";
import { Button, buttonClass, cx, ErrorText, Textarea } from "./ui";
import { ScrollTabs } from "./scroll-tabs";
import { RecordingBar, RecordingPreview, takeScreenshot, useCaptureSupport, useScreenRecorder, type Finished } from "./screen-capture";
import { CloseRunButton } from "./run-actions";
import { bugTitle } from "@/lib/jira-format";
import { RegressionNote } from "./regression";
import { SentryStepBox, type StepSentry } from "./sentry-box";
import { sentryForStep } from "@/server/sentry";
import type { KnownBug } from "@/lib/known-bugs";
import { checkKnownBug } from "@/server/known-bugs";
import { KnownBugsBox, KnownStepTag, type KnownCheck } from "./known-bugs";
import { CaseNewsNote, StepChangeTag } from "./case-news-note";
import { NewsTag } from "./case-news-tag";
import type { CaseNews } from "@/lib/case-news";

/** Regression flag: the earlier release this case passed in, and which of its steps passed there. */
export type RunnerRegression = { label: string; when: string; passed: boolean[]; resultId: string; off: boolean; jiraLabel: string };

type Attachment = { id: string; fileName: string; contentType: string; size?: number; stepIndex: number | null };
type PendingDefect = { defect: LinkedDefect; stepIndex: number | null };

export type RunnerEntry = {
  id: string;
  caseKey: string;
  caseNumber: number;
  /** The project the case lives in: an umbrella's library, for shared cases. */
  caseProjectKey?: string;
  caseId: string;
  /** Set when someone flagged the case as needing attention. */
  flag: CaseFlagInfo | null;
  caseVersion: number;
  title: string;
  tags: string[];
  preconditions: string;
  folderPath: string;
  steps: ExpandedStep[];
  /** Test data: the case runs once per row; each step's `row` says which. */
  testData?: TestData | null;
  status: ResultStatus;
  /** Results autosaved earlier and not yet saved as the case result. */
  draft: Draft | null;
  /** Who left the autosaved draft, how long ago, and whether it was you. */
  draftBy: { name: string; ago: string; mine: boolean; at?: string } | null;
  /** Jira stories the case tests, and whether the bug box ticks "Link to story" for them. */
  stories?: { key: string; title: string; status: string; url: string | null }[];
  linkStories?: boolean;
};

type Snap = Pick<Draft, "stepResults" | "override" | "comment" | "attachments" | "defects">;

// What autosave compares, leaving out the timer so only real changes save.
const contentOf = (d: Snap) =>
  JSON.stringify({ stepResults: d.stepResults, override: d.override, comment: d.comment, elapsedSec: 0, attachments: d.attachments, defects: d.defects, notes: [], reminders: [] });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type PreviousResult = {
  status: ResultStatus;
  testerName: string;
  createdAt: string;
  comment: string;
  stepStatuses: ResultStatus[];
  defects: { key: string; url: string | null; title: string }[];
  /** The saved step results and bugs, shown again when the case is reopened. */
  stepResults: { status: ResultStatus; actual: string; checks?: ResultStatus[] }[];
  links: PendingDefect[];
  /** Files saved with that result: screenshots, recordings and other attachments. */
  attachments: Attachment[];
};

// How often the open case checks for step results other people mark (every 2 s until ver_112).
const LIVE_MS = 1000;


export function Runner({
  projectId,
  projectKey,
  runNumber,
  runClosed,
  entry,
  nextEntryId,
  keepQuery = "",
  previous,
  jiraConnected,
  runDefects,
  canCloseRun = false,
  justFinished = null,
  takeBar = null,
  regression = null,
  sentryOn = false,
  tagColors,
  knownBugs = [],
  news = null,
  newsHref,
}: {
  /** New or Updated since its last run. */
  news?: CaseNews | null;
  /** Compare with the last run's copy. */
  newsHref?: string;
  /** Bugs found on this case in earlier runs. */
  knownBugs?: KnownBug[];
  /** Sentry is connected: Failed and Blocked steps show the errors it caught. */
  sentryOn?: boolean;
  tagColors?: TagColors;
  regression?: RunnerRegression | null;
  /** The "You're on this case" bar. It sits above the title and scrolls with it, so it never covers Flag or the timer. */
  takeBar?: ReactNode;
  canCloseRun?: boolean;
  /** The run this case just finished (?finished=1): show the close-the-run prompt. It lives in the URL because saving remounts the runner. */
  justFinished?: string | null;
  projectId: string;
  projectKey: string;
  runNumber: number;
  runClosed: boolean;
  entry: RunnerEntry;
  nextEntryId: string | null;
  /** Extra query (like "&only=3,5") so Save and next stays in the same list. */
  keepQuery?: string;
  previous: PreviousResult | null;
  jiraConnected: boolean;
  runDefects: LinkedDefect[];
}) {
  const spelling = useSpelling();
  const zone = useZone();
  const router = useRouter();
  const n = entry.steps.length;
  const draft = entry.draft?.stepResults.length === n ? entry.draft : null;
  // A finished case opens showing its saved result; changing it and saving records a new result.
  const saved =
    !draft && previous && previous.stepResults.length === n
      ? {
          stepResults: previous.stepResults,
          override: n && deriveCaseStatus(withoutHeadings(entry.steps, previous.stepResults.map((s) => s.status))) === previous.status ? null : previous.status,
          comment: previous.comment,
          defects: previous.links,
          attachments: previous.attachments,
        }
      : null;
  const start0 = draft ?? saved;
  // Only say "picked up where … left off" when the case opened half done, not after your own autosave.
  const resumed = useRef(draft !== null).current;
  const [changingResult, setChangingResult] = useState(false);
  // Set to the run's id once the last case is saved, to offer Close run.
  const [lastCase, setLastCase] = useState<string | null>(justFinished);
  // Dragging to select text stays inside the one action or expected result it started in,
  // so copying a URL from a step doesn't pick up the expected result (or anything below).
  const [selCell, setSelCell] = useState<string | null>(null);
  useEffect(() => {
    let cell: HTMLElement | null = null;
    const clamp = () => {
      const sel = window.getSelection();
      if (!cell || !sel || !sel.anchorNode || !sel.focusNode || cell.contains(sel.focusNode)) return;
      const after = sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (after) sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, cell, cell.childNodes.length);
      else sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, cell, 0);
    };
    const down = (e: PointerEvent) => {
      cell = (e.target as HTMLElement).closest?.<HTMLElement>("[data-sel]") ?? null;
      if (!cell) setSelCell(null);
    };
    const up = () => {
      clamp();
      cell = null;
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("selectionchange", clamp);
    document.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("selectionchange", clamp);
      document.removeEventListener("pointerup", up);
    };
  }, []);
  const reopened = useRef(saved !== null).current;
  // Shared steps with several checks in them get a result per check; shared step headings and
  // section titles (a step with nothing to check, like "SIGN IN / OUT STEPS") take no result.
  const parsed = useMemo(() => readSteps(entry.steps), [entry.steps]);
  const heading = useCallback((i: number) => parsed[i]?.kind === "heading", [parsed]);
  const checkCount = useCallback((i: number) => (parsed[i]?.kind === "checks" ? (parsed[i] as { count: number }).count : 0), [parsed]);
  const [checkResults, setCheckResults] = useState<ResultStatus[][]>(() =>
    parsed.map((p, i) => {
      if (p?.kind !== "checks") return [];
      const was = start0?.stepResults[i];
      if (was?.checks?.length === p.count) return was.checks;
      // A result saved before the step had checks: every check takes the step's result.
      return Array(p.count).fill(was?.status ?? "UNTESTED");
    }),
  );
  // Within a step with checks, the check the keys mark next.
  const [curCheck, setCurCheck] = useState(0);
  /** The next step that takes a result, skipping headings, or -1. */
  const stepAfter = useCallback(
    (i: number, dir: 1 | -1 = 1) => {
      for (let j = i + dir; j >= 0 && j < n; j += dir) if (!heading(j)) return j;
      return -1;
    },
    [n, heading],
  );
  const [statuses, setStatuses] = useState<ResultStatus[]>(() => start0?.stepResults.map((s) => s.status) ?? Array(n).fill("UNTESTED"));
  const [actuals, setActuals] = useState<string[]>(() => start0?.stepResults.map((s) => s.actual) ?? Array(n).fill(""));
  // Pick up at the first step without a result.
  const [current, setCurrent] = useState(() => {
    const at = draft ? draft.stepResults.findIndex((s, i) => s.status === "UNTESTED" && !heading(i)) : 0;
    return Math.max(0, at >= 0 && heading(at) ? stepAfter(at) : at);
  });
  // A step with checks takes its result from them.
  useEffect(() => {
    setStatuses((prev) => {
      const next = prev.map((s, i) => (checkCount(i) ? rollUp(checkResults[i]) : s));
      return same(next, prev) ? prev : next;
    });
  }, [checkResults, checkCount]);
  const [override, setOverride] = useState<ResultStatus | null>(start0?.override ?? null);
  // Test data: the steps hold one copy per row; the runner shows one row at a time.
  const data: TestData | null = entry.testData && entry.steps.some((st) => st.row !== undefined) ? entry.testData : null;
  const activeRow = data ? (entry.steps[current]?.row ?? 0) : null;
  const rowStatuses = useMemo(
    () => (data ? rowResults(entry.steps.map((st, i) => (heading(i) ? undefined : st.row)), statuses, data.rows.length) : []),
    [data, entry.steps, statuses, heading],
  );
  /** Open a row: its first step without a result, or its first step. */
  const goRow = useCallback(
    (r: number) => {
      const mine = entry.steps.flatMap((st, i) => (st.row === r && !heading(i) ? [i] : []));
      const at = mine.find((i) => statuses[i] === "UNTESTED") ?? mine[0];
      if (at !== undefined) {
        setCurrent(at);
        setCurCheck(0);
      }
    },
    [entry.steps, heading, statuses],
  );
  // Save and next on a case with no step marked asks first.
  const [askSkip, setAskSkip] = useState(false);
  const [passThenNext, setPassThenNext] = useState(false);
  const [comment, setComment] = useState(start0?.comment ?? "");
  const [defects, setDefects] = useState<PendingDefect[]>(start0?.defects ?? []);
  const [attachments, setAttachments] = useState<Attachment[]>(start0?.attachments ?? []);
  const [bugFor, setBugFor] = useState<number | null | undefined>(undefined); // undefined = closed, null = whole case
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  // Saved and on the way to the next case: stays busy until that case opens.
  const [leaving, setLeaving] = useState(false);
  const saving = pending || leaving;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const startedAt = useRef(Date.now() - (draft?.elapsedSec ?? 0) * 1000);
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadStep = useRef<number | null>(null);
  const dirty = statuses.some((s) => s !== "UNTESTED") || comment !== "" || defects.length > 0 || attachments.length > 0;
  // Sentry: when each step was opened, and the errors found for Failed or Blocked ones.
  const opened = useRef<Record<number, number>>({});
  const [sentry, setSentry] = useState<Record<number, StepSentry>>({});

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Autosave: every change is saved shortly after it's made, so leaving the
  // case half done keeps its step results. The case shows In progress meanwhile.
  const [saveState, setSaveState] = useState<"idle" | "waiting" | "saving" | "saved" | "error">(draft ? "saved" : "idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<unknown> | null>(null);
  const finished = useRef(false);
  const payload = useRef<Draft | null>(null);
  payload.current = {
    stepResults: statuses.map((status, i) => ({
      status: status as Draft["stepResults"][number]["status"],
      actual: actuals[i],
      ...(checkCount(i) ? { checks: checkResults[i] as Draft["stepResults"][number]["status"][] } : {}),
    })),
    override: override as Draft["override"],
    comment,
    elapsedSec: Math.floor((Date.now() - startedAt.current) / 1000),
    attachments,
    defects,
    notes: [],
    reminders: [],
  };
  // What was last saved (or loaded), ignoring the timer, so only real changes save.
  const content = contentOf(payload.current);
  const savedContent = useRef(content);
  const loadedContent = useRef(content);
  // The case as the server last told us. Anything that differs from it is
  // this tester's own change: only those parts are sent, and only the rest
  // takes other people's changes, so two people on one case never wipe each other.
  const base = useRef<Snap>(payload.current);
  const seenAt = useRef(entry.draftBy?.at ?? null);

  const applyRemote = useCallback((remote: Snap) => {
    const cur = payload.current!;
    const b = base.current;
    const wasSaved = contentOf(cur) === savedContent.current;
    const next: Snap = {
      stepResults: cur.stepResults.map((s, i) => (same(s, b.stepResults[i]) ? remote.stepResults[i] : s)),
      override: cur.override === b.override ? remote.override : cur.override,
      comment: cur.comment === b.comment ? remote.comment : cur.comment,
      attachments: same(cur.attachments, b.attachments) ? remote.attachments : cur.attachments,
      defects: same(cur.defects, b.defects) ? remote.defects : cur.defects,
    };
    base.current = remote;
    if (contentOf(next) === contentOf(cur)) return;
    setStatuses(next.stepResults.map((s) => s.status));
    setCheckResults((prev) => prev.map((c, i) => (c.length && next.stepResults[i]?.checks?.length === c.length ? next.stepResults[i].checks! : c)));
    setActuals(next.stepResults.map((s) => s.actual));
    setOverride(next.override);
    setComment(next.comment);
    setAttachments(next.attachments);
    setDefects(next.defects as PendingDefect[]);
    // Someone else's change isn't yours to save again.
    if (wasSaved) savedContent.current = contentOf(next);
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (finished.current || !payload.current) return Promise.resolve(true);
    const sent = payload.current;
    const b = base.current;
    const touched = {
      steps: sent.stepResults.flatMap((s, i) => (same(s, b.stepResults[i]) ? [] : [i])),
      override: sent.override !== b.override,
      comment: sent.comment !== b.comment,
      attachments: !same(sent.attachments, b.attachments),
      defects: !same(sent.defects, b.defects),
    };
    savedContent.current = contentOf(sent);
    setSaveState("saving");
    const p = saveDraft(projectId, entry.id, { ...sent, elapsedSec: Math.floor((Date.now() - startedAt.current) / 1000) }, touched).then((res) => {
      if (inflight.current === p) inflight.current = null;
      if (finished.current) return res.ok;
      setSaveState(res.ok ? "saved" : "error");
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      // What we sent is now on the server, along with anyone else's changes.
      base.current = {
        stepResults: b.stepResults.map((s, i) => (touched.steps.includes(i) ? sent.stepResults[i] : s)),
        override: touched.override ? sent.override : b.override,
        comment: touched.comment ? sent.comment : b.comment,
        attachments: touched.attachments ? sent.attachments : b.attachments,
        defects: touched.defects ? sent.defects : b.defects,
      };
      seenAt.current = res.draftAt;
      if (res.draft) applyRemote(res.draft);
      return true;
    });
    inflight.current = p;
    return p;
  }, [projectId, entry.id, applyRemote]);

  // Live: pick up step results other people mark on this case while it's open,
  // and who made the last change.
  const [lastBy, setLastBy] = useState<{ name: string; mine: boolean; at: string } | null>(
    entry.draftBy?.at ? { name: entry.draftBy.name, mine: entry.draftBy.mine, at: entry.draftBy.at } : null,
  );
  const [savedElsewhere, setSavedElsewhere] = useState<{ testerName: string; status: ResultStatus; mine: boolean } | null>(null);
  const previousAt = previous?.createdAt ?? null;
  useEffect(() => {
    if (runClosed) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden && !inflight.current && !finished.current) {
        try {
          const r = await fetch(`/api/live/entries/${entry.id}`, { cache: "no-store" });
          if (r.ok && !stop && !inflight.current && !finished.current) {
            const d = (await r.json()) as {
              draft: Draft | null;
              draftAt: string | null;
              draftBy: { name: string; mine: boolean } | null;
              lastResult: { testerName: string; status: ResultStatus; mine: boolean; at: string } | null;
            };
            if (d.draft && d.draftAt && d.draftAt !== seenAt.current && d.draft.stepResults.length === n) {
              seenAt.current = d.draftAt;
              applyRemote(d.draft);
            }
            setLastBy(d.draftBy && d.draftAt ? { ...d.draftBy, at: d.draftAt } : null);
            setSavedElsewhere(d.lastResult && d.lastResult.at !== previousAt ? d.lastResult : null);
          }
        } catch {
          // Offline or the server restarted; try again next time.
        }
      }
      if (!stop) t = setTimeout(tick, LIVE_MS);
    };
    t = setTimeout(tick, LIVE_MS);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [entry.id, n, runClosed, applyRemote, previousAt]);

  useEffect(() => {
    if (runClosed || finished.current || content === savedContent.current) return;
    setSaveState("waiting");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [content, runClosed, flush]);

  // Leaving the page (another case, another tab of the app) saves straight away.
  useEffect(() => () => void (timer.current && flush()), [flush]);

  const unsaved = saveState === "waiting" || saveState === "saving" || saveState === "error";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, flush]);

  // Don't let other people's live changes reset this case while you're filling it in.
  const busy = dirty || actuals.some((a) => a !== "") || bugFor !== undefined;
  const firstFailed = statuses.findIndex((st) => st === "FAILED");
  // Report bug for case (persona audit #4): start from the first failed step, not the
  // case's title. Other failed steps and the case comment go in What happened too.
  // Test data: a bug's title says which row, like "(Safari · viewer)".
  const withRow = (title: string, i: number) => {
    const r = entry.steps[i]?.row;
    return data && r !== undefined ? `${title} (${rowLabel(data, r)})`.slice(0, 250) : title;
  };
  const caseBug = (() => {
    const failed = statuses.flatMap((st, i) => (st === "FAILED" ? [i] : []));
    const focus = failed[0] ?? null;
    if (focus === null) return { focus, actual: comment, suggested: comment.trim() ? bugTitle(entry.title, null, comment) : "" };
    const more = failed.slice(1).map((i) => `${labelOfStep(entry.steps[i])} also failed${actuals[i]?.trim() ? `: ${actuals[i].trim()}` : "."}`);
    const actual = [actuals[focus]?.trim() ?? "", ...more, comment.trim() && `Comment: ${comment.trim()}`].filter(Boolean).join("\n\n");
    return { focus, actual, suggested: withRow(bugTitle(entry.title, entry.steps[focus] ?? null, actuals[focus] ?? ""), focus) };
  })();
  useEffect(() => (busy ? holdLive() : undefined), [busy]);
  // That hold also stops the run list refreshing, so hand it this case's step results directly.
  // Headings take no result, so they don't hold the case back or show as pips.
  const resultSteps = useMemo(() => statuses.filter((_, i) => !heading(i)), [statuses, heading]);
  useEffect(() => publishLiveSteps(entry.id, resultSteps), [entry.id, resultSteps]);
  useEffect(() => () => publishLiveSteps(entry.id, null), [entry.id]);

  const derived = resultSteps.length ? deriveCaseStatus(resultSteps) : "UNTESTED";
  const caseStatus = override ?? derived;
  // No case result yet: saving keeps the progress and the case stays In progress.
  const partial = caseStatus === "UNTESTED";

  // A failed step's note box and Report bug come into view (persona audit #5).
  // Clicking Failed also puts the cursor in the note; the F key only scrolls, so keys keep marking steps.
  const [reveal, setReveal] = useState<{ i: number; focus: boolean; n: number } | null>(null);
  const setStep = useCallback(
    (i: number, s: ResultStatus) => {
      if (heading(i)) return;
      if (s === "FAILED") setReveal((r) => ({ i, focus: false, n: (r?.n ?? 0) + 1 }));
      // A step with checks: its own buttons fill the empty checks, or set them all when none are empty.
      if (checkCount(i)) setCheckResults((prev) => prev.map((c, j) => (j === i ? fillChecks(c, s) : c)));
      // A status always sets that status, never toggles it off (pressing P twice used to clear a pass). U or Clear empties it.
      else setStatuses((prev) => prev.map((x, j) => (j === i ? s : x)));
      // Move on after a pass; stay put on a problem so the tester can describe it.
      if (s === "PASSED" && stepAfter(i) >= 0) {
        setCurrent(stepAfter(i));
        setCurCheck(0);
      }
    },
    [heading, checkCount, stepAfter],
  );
  /** One check's result. Pressing the one it already has clears it. Keys move on to the next check. */
  const setCheck = useCallback(
    (i: number, k: number, s: ResultStatus, fromKey = false) => {
      setCheckResults((prev) => prev.map((c, j) => (j === i ? c.map((x, m) => (m === k ? (!fromKey && x === s ? "UNTESTED" : s) : x)) : c)));
      if (!fromKey) return;
      if (k + 1 < checkCount(i)) setCurCheck(k + 1);
      else if (stepAfter(i) >= 0) {
        setCurrent(stepAfter(i));
        setCurCheck(0);
      }
    },
    [checkCount, stepAfter],
  );
  /** Sets every step's result at once; a step with checks gives all of them that result. */
  const applyStatuses = useCallback(
    (next: ResultStatus[]) => {
      setCheckResults((prev) => prev.map((c, i) => (c.length && rollUp(c) !== next[i] ? c.map(() => next[i] ?? "UNTESTED") : c)));
      setStatuses(next);
    },
    [],
  );

  // Sentry: the clock for a step starts when it's opened.
  useEffect(() => {
    opened.current[current] ??= Date.now();
  }, [current]);
  useEffect(() => {
    if (!sentryOn || runClosed) return;
    statuses.forEach((st, i) => {
      if ((st !== "FAILED" && st !== "BLOCKED") || sentry[i]) return;
      setSentry((x) => ({ ...x, [i]: { loading: true, errors: [], picked: [], searchUrl: "" } }));
      const openedAt = new Date(opened.current[i] ?? startedAt.current).toISOString();
      void sentryForStep(projectId, entry.id, { openedAt, stepIndex: i }).then((r) =>
        setSentry((x) => ({
          ...x,
          [i]: r.ok ? { loading: false, errors: r.errors, picked: [], searchUrl: r.searchUrl, onlyYours: "onlyYours" in r ? r.onlyYours : undefined } : { loading: false, errors: [], picked: [], searchUrl: "", error: r.error },
        })),
      );
    });
    // Only when a step's status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, sentryOn]);
  const sentryPicked = (i: number | null) =>
    Object.entries(sentry).flatMap(([k, v]) => (i === null || Number(k) === i ? v.errors.filter((e) => v.picked.includes(e.id)).map((e) => ({ ...e, stepIndex: Number(k) })) : []));

  // Known bugs: Still happens fails its step, links the bug and says so in the comment; Didn't happen just records it.
  const [checks, setChecks] = useState<Record<string, KnownCheck | undefined>>(() => Object.fromEntries(knownBugs.map((b) => [b.id, b.check?.outcome])));
  const before = useRef<Record<string, { status: ResultStatus | null; line: string }>>({});
  const checkKnown = (b: KnownBug, outcome: KnownCheck | null) => {
    const was = checks[b.id];
    setChecks((c) => ({ ...c, [b.id]: outcome ?? undefined }));
    if (was === "still") {
      // Undo: take back what Still happens did.
      const prev = before.current[b.id];
      setDefects((all) => all.filter((d) => d.defect.id !== b.id));
      if (prev && b.stepIndex !== null && prev.status) applyStatuses(statusesRef.current.map((x, j) => (j === b.stepIndex ? prev.status! : x)));
      if (prev) setComment((c) => c.replace(prev.line, "").replace(/\n{2,}/g, "\n").trim());
      delete before.current[b.id];
    }
    if (outcome === "still") {
      const line = `${b.key} still happens (same as ${b.found.label}).`;
      before.current[b.id] = { status: b.stepIndex === null ? null : statusesRef.current[b.stepIndex], line };
      setDefects((all) => (all.some((d) => d.defect.id === b.id) ? all : [...all, { defect: { id: b.id, number: b.number, title: b.title, externalKey: b.externalKey, externalUrl: b.url, status: b.status }, stepIndex: b.stepIndex }]));
      if (b.stepIndex !== null) {
        setStep(b.stepIndex, "FAILED");
        setCurrent(b.stepIndex);
      }
      setComment((c) => (c.includes(line) ? c : [c.trim(), line].filter(Boolean).join("\n")));
    }
    start(async () => {
      const r = await checkKnownBug(projectId, entry.id, b.id, outcome);
      if (!r.ok) setError(r.error);
    });
  };

  // "Bug still occurs" in the history panel: copy that execution's step
  // results and bugs into this case, so a known bug is re-reported in one click.
  useEffect(() => {
    const apply = (e: Event) => {
      const past = (e as CustomEvent<HistoryRun>).detail;
      if (runClosed) return;
      const marked = statusesRef.current.some((x) => x !== "UNTESTED");
      if (marked && !window.confirm("Replace the step results you've already entered with the ones from that run?")) return;
      const where = mapHistorySteps(past.steps, entry.steps);
      const nextStatuses: ResultStatus[] = Array(n).fill("UNTESTED");
      const nextActuals: string[] = Array(n).fill("");
      past.steps.forEach((st, j) => {
        if (where[j] < 0) return;
        nextStatuses[where[j]] = st.status;
        nextActuals[where[j]] = st.actual;
      });
      const bugs: PendingDefect[] = past.defects.map((d) => {
        const i = d.stepIndex === null ? -1 : (where[d.stepIndex] ?? -1);
        // A step with a bug on it fails if the old run left it unmarked.
        if (i >= 0 && nextStatuses[i] === "UNTESTED") nextStatuses[i] = "FAILED";
        return { defect: d.defect, stepIndex: i >= 0 ? i : null };
      });
      applyStatuses(nextStatuses);
      setActuals(nextActuals);
      setDefects(bugs.filter((b, k) => bugs.findIndex((x) => x.defect.id === b.defect.id && x.stepIndex === b.stepIndex) === k));
      setOverride(n && deriveCaseStatus(withoutHeadings(entry.steps, nextStatuses)) === past.status ? null : past.status === "UNTESTED" ? null : past.status);
      const keys = [...new Set(past.defects.map((d) => d.defect.externalKey ?? `D-${d.defect.number}`))].join(", ");
      setComment((c) => c || `Bug still occurs: ${keys} (same as ${past.runTag || past.runName}).`);
      const firstProblem = nextStatuses.findIndex((x) => x !== "UNTESTED" && x !== "PASSED" && x !== "SKIPPED");
      if (firstProblem >= 0) setCurrent(firstProblem);
      setError(null);
    };
    window.addEventListener(STILL_OCCURS_EVENT, apply);
    return () => window.removeEventListener(STILL_OCCURS_EVENT, apply);
  }, [entry.steps, n, runClosed, applyStatuses]);

  const upload = useCallback(
    async (files: File[], stepIndex: number | null) => {
      setUploading(true);
      const added: (Attachment & { size: number })[] = [];
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        if (stepIndex !== null) form.set("stepIndex", String(stepIndex));
        const res = await uploadAttachment(projectId, form);
        if (res.ok) {
          const a = { ...res.attachment, stepIndex };
          added.push(a);
          setAttachments((all) => [...all, a]);
        } else setError(res.error);
      }
      setUploading(false);
      return added;
    },
    [projectId],
  );

  // Take screenshot / Record screen: the browser's own screen sharing, attached like any other file.
  const capture = useCaptureSupport();
  const stepLabel = (i: number | null) => (i === null ? "the case" : entry.steps[i] ? labelOfStep(entry.steps[i]).toLowerCase() : `step ${i + 1}`);
  const fileLabel = (i: number | null) => (i === null ? "Whole case" : `Step ${entry.steps[i]?.number ?? i + 1}`);
  const captureName = (i: number | null) => `${entry.caseKey} ${i === null ? "case" : `step ${entry.steps[i]?.number ?? i + 1}`}`;
  const [preview, setPreview] = useState<{ id: string; fileName: string; seconds: number; size: number; stepIndex: number | null } | null>(null);
  const recorder = useScreenRecorder(
    useCallback(
      async (f: Finished) => {
        const [a] = await upload([f.file], f.stepIndex);
        if (a) setPreview({ id: a.id, fileName: a.fileName, seconds: f.seconds, size: a.size, stepIndex: f.stepIndex });
      },
      [upload],
    ),
    useCallback((m: string) => setError(m), []),
  );
  const recording = useRef(false);
  recording.current = recorder.rec !== null;
  const screenshot = async (i: number | null) => {
    setError(null);
    try {
      const file = await takeScreenshot(`${captureName(i)} screenshot.png`);
      if (file) await upload([file], i);
    } catch {
      setError("Couldn't take the screenshot.");
    }
  };
  const record = (i: number | null) => {
    setError(null);
    setPreview(null);
    void recorder.start({ stepIndex: i, label: i === null ? "for the case" : `for ${stepLabel(i)}`, baseName: captureName(i) });
  };
  const captureButtons = (i: number | null) => (
    <>
      <Button size="sm" disabled={!capture.ok || uploading || runClosed} title={capture.ok ? `Pick a tab, window or screen and attach a still image of it to ${stepLabel(i)}` : capture.why} onClick={() => void screenshot(i)} data-howto="runner-screenshot">
        📷 Take screenshot
      </Button>
      <Button
        size="sm"
        disabled={!capture.ok || runClosed || recorder.rec !== null}
        title={capture.ok ? `Record a tab, window or screen for up to 5 minutes and attach the video to ${stepLabel(i)}` : capture.why}
        onClick={() => record(i)}
        data-howto="runner-record"
      >
        <span aria-hidden className="text-red-600">●</span> {i === null ? "Record screen for case" : "Record screen"}
      </Button>
    </>
  );

  const submit = useCallback(
    (goNext: boolean, skipUnmarked = false) => {
      if (leaving) return;
      setError(null);
      setAskSkip(false);
      if (recording.current) return setError("Stop the screen recording first: Stop and attach, or Discard.");
      const runPath = `/p/${projectKey}/runs/${runNumber}`;
      // Plain Save stays on this case; the refresh below reloads it with the saved result.
      const goOn = () => goNext && router.push(nextEntryId ? `${runPath}/execute?entry=${nextEntryId}${keepQuery}` : runPath);
      // Opening the next case from inside the save made Next.js load it twice, so it opens just
      // after. The next case loads fresh; the run page may be kept from earlier, so refresh it.
      const leave = () => {
        setLeaving(true);
        setTimeout(() => {
          goOn();
          if (!nextEntryId) router.refresh();
        }, 0);
      };
      // Not finished: keep the step results (autosave has them) and leave the case In progress.
      if (caseStatus === "UNTESTED") {
        // Nothing marked at all: ask rather than quietly moving on and leaving the case Untested.
        if (goNext && !skipUnmarked && n > 0 && statuses.every((x) => x === "UNTESTED")) return setAskSkip(true);
        start(async () => {
          const ok = timer.current ? await flush() : await (inflight.current ?? true);
          if (ok === false) return;
          if (goNext) leave();
          else router.refresh();
        });
        return;
      }
      // Nothing changed on a reopened finished case: keep its result rather than saving a copy.
      if (reopened && JSON.stringify({ ...payload.current, elapsedSec: 0 }) === loadedContent.current) return goOn();
      start(async () => {
        // Let a pending autosave land first, so it can't bring the draft back afterwards.
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        finished.current = true;
        await inflight.current;
        const res = await submitResult(projectId, entry.id, {
          status: caseStatus as Exclude<Draft["override"], null>,
          stepResults: payload.current!.stepResults,
          comment,
          elapsedSec: Math.floor((Date.now() - startedAt.current) / 1000),
          attachmentIds: attachments.map((a) => a.id),
          defects: defects.map((d) => ({ existingId: d.defect.id, stepIndex: d.stepIndex })),
          sentry: sentryPicked(null),
        });
        if (!res.ok) {
          finished.current = false;
          return setError(res.error);
        }
        showQuestMoments(res.quest);
        // The last case of the run: offer to close it rather than dropping back to the run page.
        if (goNext && !nextEntryId && res.runDone) {
          router.replace(`${runPath}/execute?entry=${entry.id}&finished=1${keepQuery}`);
          return;
        }
        if (goNext) leave();
        else router.refresh();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseStatus, statuses, n, projectId, entry.id, comment, attachments, defects, projectKey, runNumber, nextEntryId, keepQuery, router, reopened, flush, sentry, leaving],
  );

  // Marking any step answers the no-result question.
  useEffect(() => setAskSkip(false), [statuses]);

  // "Pass all and next" from the no-result question: save once the passes are in.
  useEffect(() => {
    if (!passThenNext || caseStatus === "UNTESTED") return;
    setPassThenNext(false);
    submit(true);
  }, [passThenNext, caseStatus, submit]);

  // Keyboard: P F B D R S mark the current step, arrows or J/K move, Ctrl+Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K search has its own keys (Ctrl+Enter opens a result in a new tab).
      if ((e.target as HTMLElement).closest?.("dialog[aria-label='Search']")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit(true);
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, dialog") || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (data && activeRow !== null && (k === "]" || k === "[")) {
        e.preventDefault();
        const to = activeRow + (k === "]" ? 1 : -1);
        if (to >= 0 && to < data.rows.length) goRow(to);
        return;
      }
      // Arrows go check by check inside a step with checks, and skip headings.
      const many = checkCount(current);
      if (k === "arrowdown" || k === "j") {
        e.preventDefault();
        if (many && curCheck < many - 1) setCurCheck(curCheck + 1);
        else if (stepAfter(current) >= 0) {
          setCurrent(stepAfter(current));
          setCurCheck(0);
        }
      } else if (k === "arrowup" || k === "k") {
        e.preventDefault();
        if (many && curCheck > 0) setCurCheck(curCheck - 1);
        else if (stepAfter(current, -1) >= 0) {
          const to = stepAfter(current, -1);
          setCurrent(to);
          setCurCheck(Math.max(0, checkCount(to) - 1));
        }
      } else if (k === "u" && n) {
        e.preventDefault();
        if (many) setCheck(current, curCheck, "UNTESTED", true);
        else setStep(current, "UNTESTED");
      } else {
        const hit = SETTABLE.find((s) => s.key === k);
        if (hit && n) {
          e.preventDefault();
          if (many) setCheck(current, curCheck, hit.status, true);
          else setStep(current, hit.status);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, curCheck, n, setStep, setCheck, checkCount, stepAfter, submit, data, activeRow, goRow]);

  // Paste a screenshot anywhere to attach it to the current step.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void upload(
        files.map((f) => new File([f], f.name && f.name !== "image.png" ? f.name : `step-${current + 1}-screenshot.png`, { type: f.type })),
        n ? current : null,
      );
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [current, n, upload]);

  useEffect(() => {
    document.querySelector(`[data-step="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);
  useEffect(() => {
    if (!reveal) return;
    const box = document.querySelector<HTMLElement>(`[data-step="${reveal.i}"] [data-problem-box]`);
    if (!box) return;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (reveal.focus) box.querySelector("textarea")?.focus({ preventScroll: true });
  }, [reveal]);

  const stepCounts = useMemo(() => {
    const c: Partial<Record<ResultStatus, number>> = {};
    for (const s of resultSteps) c[s] = (c[s] ?? 0) + 1;
    return c;
  }, [resultSteps]);

  const recent = useMemo(() => {
    const seen = new Set(defects.map((d) => d.defect.id));
    return runDefects.filter((d) => !seen.has(d.id));
  }, [runDefects, defects]);

  // Someone else changed this case in the last half hour.
  const othersActive = !!lastBy && !lastBy.mine && Date.now() - Date.parse(lastBy.at) < 30 * 60_000;
  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    // On wide screens the steps scroll on their own and the case result stays put underneath them.
    <div className="min-w-0 flex-1 lg:flex lg:min-h-0 lg:flex-col bigtext:block">
      <div data-steps-scroll className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1 lg:pb-2 bigtext:overflow-visible bigtext:pr-0">
        {takeBar && <div className="mb-3">{takeBar}</div>}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              <Link href={`/p/${entry.caseProjectKey ?? projectKey}/cases/${entry.caseNumber}`} className="font-mono hover:underline" target="_blank">
                {entry.caseKey}
              </Link>{" "}
              · version {entry.caseVersion}
              {entry.folderPath && ` · ${entry.folderPath}`}
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              {entry.tags.length > 0 && (
                <span className="mr-1.5 inline-flex gap-1 align-[3px]">
                  <TagPills tags={entry.tags} colors={tagColors} />
                </span>
              )}
              {entry.title}
              {news && <NewsTag kind={news.kind} className="ml-2 align-[3px]" />}
            </h1>
            {!!entry.stories?.length && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                Tests
                {entry.stories.map((st) =>
                  st.url ? (
                    <a key={st.key} href={st.url} target="_blank" rel="noreferrer" title={[st.title, st.status].filter(Boolean).join(" · ")} className="rounded border border-slate-200 bg-surface px-1.5 py-0.5 font-mono text-accent-700 hover:underline">
                      {st.key} ↗
                    </a>
                  ) : (
                    <span key={st.key} title={st.title} className="rounded border border-slate-200 bg-surface px-1.5 py-0.5 font-mono">
                      {st.key}
                    </span>
                  ),
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <CaseFlagButton projectId={projectId} projectKey={projectKey} caseId={entry.caseId} flag={entry.flag} runNumber={runNumber} />
            <span title="Time on this case" className="tabular-nums">
              ⏱ {mm}
            </span>
            <StatusChip status={entry.status} />
          </div>
        </div>

        {runClosed && <p className="mb-3 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">This run is closed. Reopen it to record results.</p>}

        {previous && (
          <div className="mb-4 rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-600">
            Last result in this run: <StatusChip status={previous.status} /> by {previous.testerName}{" "}
            <span suppressHydrationWarning>{dateTime(new Date(previous.createdAt), spelling, zone)}</span>
            {previous.comment && <span className="block text-xs text-slate-500">“{previous.comment}”</span>}
            {saved && <span className="block text-xs text-slate-500">Its step results are shown below. Change anything and save to record a new result.</span>}
            {previous.defects.length > 0 && (
              <span className="block text-xs">
                Bugs:{" "}
                {previous.defects.map((d, i) => (
                  <span key={d.key}>
                    {i > 0 && ", "}
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
                        {d.key}
                      </a>
                    ) : (
                      d.key
                    )}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {savedElsewhere && (
          <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {savedElsewhere.mine ? "You" : savedElsewhere.testerName} saved this case as {STATUS_LABEL[savedElsewhere.status]}. Saving here records another result.
          </p>
        )}
        {othersActive ? (
          <p className="mb-4 flex items-center gap-2 text-sm text-slate-600" role="status">
            <span className={cx("h-2 w-2 shrink-0 rounded-full", Date.now() - Date.parse(lastBy!.at) < 2 * 60_000 ? "bg-emerald-500" : "bg-slate-300")} />
            <span>
              <span className="font-medium text-slate-800">{lastBy!.name}</span> is working on this case · last change{" "}
              <span suppressHydrationWarning>{relativeTime(new Date(lastBy!.at), spelling)}</span>
            </span>
          </p>
        ) : resumed && draft && entry.draftBy && (
          <p className="mb-4 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            Picked up where {entry.draftBy.mine ? "you" : entry.draftBy.name} left off {entry.draftBy.ago}.{" "}
            {draft.stepResults.filter((s) => s.status !== "UNTESTED").length} of {n} steps have results.
          </p>
        )}

        <CaseNewsNote news={news} href={newsHref} />

        <KnownBugsBox bugs={knownBugs} checks={checks} onCheck={checkKnown} disabled={runClosed} steps={entry.steps} />

        {entry.preconditions && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-medium">Preconditions: </span>
            {entry.preconditions}
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span className="fp-keyhint">
            Keys: {SETTABLE.map((s) => (
              <span key={s.key} className="mr-1.5">
                <kbd>{s.key.toUpperCase()}</kbd> {STATUS_LABEL[s.status].toLowerCase()}
              </span>
            ))}
            <kbd>U</kbd> clear <kbd>↑</kbd>
            <kbd>↓</kbd> move{data && <> · <kbd>[</kbd> <kbd>]</kbd> row</>} · paste a screenshot to attach it
          </span>
          {n > 0 && (
            <button
              type="button"
              className="text-accent-700 hover:underline"
              onClick={() => {
                // With test data, only the row on screen: the other rows still need running.
                const here = (i: number) => activeRow === null || entry.steps[i]?.row === activeRow;
                setCheckResults((prev) => prev.map((c, i) => (here(i) ? c.map((x) => (x === "UNTESTED" ? "PASSED" : x)) : c)));
                setStatuses((prev) => prev.map((s, i) => (s === "UNTESTED" && here(i) && !heading(i) && !checkCount(i) ? "PASSED" : s)));
              }}
            >
              {activeRow === null ? "Pass all remaining steps" : `Pass the rest of row ${activeRow + 1}`}
            </button>
          )}
        </div>

        {data && activeRow !== null && (
          <div className="mb-3 grid gap-2" data-testid="test-data-rows">
            <p className="text-sm text-slate-600">
              This case runs once for each row of test data. Values from the row show in <span className="rounded bg-blue-50 px-0.5 font-medium text-blue-800 ring-1 ring-blue-100 ring-inset">blue</span>.
            </p>
            <ScrollTabs tablist label="Test data rows" className="flex gap-2 p-1">
              {data.rows.map((_, r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={r === activeRow}
                  onClick={() => goRow(r)}
                  className={cx(
                    "grid min-w-0 shrink-0 gap-0.5 rounded-lg border bg-surface px-3 py-1.5 text-left text-xs",
                    r === activeRow ? "border-accent-500 ring-2 ring-accent-500/20" : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <span className="flex items-center gap-1.5 font-medium text-slate-800">
                    Row {r + 1} <StatusChip status={rowStatuses[r] ?? "UNTESTED"} />
                  </span>
                  <span className="max-w-48 truncate text-slate-500">{rowLabel(data, r)}</span>
                </button>
              ))}
            </ScrollTabs>
          </div>
        )}
        <ol className="space-y-2">
          {entry.steps.map((step, i) => {
            if (activeRow !== null && step.row !== activeRow) return null;
            const s = statuses[i];
            const problem = s !== "UNTESTED" && s !== "PASSED" && s !== "SKIPPED";
            const stepDefects = defects.filter((d) => d.stepIndex === i);
            const stepFiles = attachments.filter((a) => a.stepIndex === i);
            const read = parsed[i];
            const sharedLabel = firstOfShared(entry.steps, i) && (
              <p className="mt-3 mb-1 text-xs text-violet-700">
                Shared step: <span className="font-medium">{step.shared!.name}</span> v{step.shared!.version}
              </p>
            );
            if (read?.kind === "heading" && !firstOfShared(entry.steps, i)) {
              // A section title: names the steps under it, up to the next title.
              let under = 0;
              for (let j = i + 1; j < entry.steps.length && parsed[j]?.kind !== "heading"; j++) if (entry.steps[j].row === step.row) under++;
              return (
                <li key={i} data-step={i}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-slate-300 px-1 pt-4 pb-1">
                    <h3 className="text-[15px] font-bold tracking-wide text-slate-800 wrap-anywhere">{read.text}</h3>
                    <span className="text-xs text-slate-500">
                      {under} {under === 1 ? "step" : "steps"}
                    </span>
                  </div>
                </li>
              );
            }
            if (read?.kind === "heading")
              return (
                <li key={i} data-step={i}>
                  {sharedLabel}
                  <div className="flex items-baseline gap-3 border-b border-violet-200 px-3 pt-2 pb-1">
                    <span className="w-9 shrink-0 font-mono text-sm font-semibold text-slate-400">{step.number}</span>
                    <span className="text-xs font-semibold tracking-wide text-violet-800 uppercase">{read.text}</span>
                    <span className="text-xs text-slate-400 italic">heading, no result needed</span>
                  </div>
                </li>
              );
            const many = read?.kind === "checks" ? read : null;
            const marked = many ? checkResults[i].filter((c) => c !== "UNTESTED").length : 0;
            return (
              <li key={i} data-step={i}>
                {sharedLabel}
                <div
                  onClick={() => setCurrent(i)}
                  className={cx(
                    "rounded-lg border bg-surface p-3 shadow-sm transition",
                    current === i ? "border-accent-500 ring-2 ring-accent-500/20" : "border-slate-200",
                    step.shared && "border-l-4 border-l-violet-300",
                  )}
                >
                  <div className="flex flex-wrap gap-3">
                    <span className="w-9 shrink-0 pt-0.5 font-mono text-sm font-semibold text-slate-500 select-none">{step.number}</span>
                    <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2 md:gap-0">
                      <div
                        data-sel
                        onPointerDown={() => setSelCell(`a${i}`)}
                        className={cx("min-w-0 text-sm text-slate-900 md:pr-3", selCell && selCell !== `a${i}` && "select-none")}
                      >
                        <span className="block text-[11px] font-medium tracking-wide text-slate-400 uppercase select-none">Step</span>
                        {knownBugs.some((b) => b.stepIndex === i) && (
                          <span className="mb-1 flex flex-wrap gap-1 select-none">
                            {knownBugs
                              .filter((b) => b.stepIndex === i)
                              .map((b) => (
                                <KnownStepTag key={b.id} bug={b} />
                              ))}
                          </span>
                        )}
                        {news?.kind === "updated" && <StepChangeTag change={news.steps[i]} />}
                        {many ? (
                          <span className="block">
                            <span className="font-medium">{many.title}</span>
                            {many.notOn.map((p) => (
                              <span key={p} className="ml-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[11px] text-slate-600 ring-1 ring-slate-200 ring-inset">
                                Not on {p}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <StepText text={step.action} marks={step.vals} className="whitespace-pre-wrap wrap-anywhere" />
                        )}
                      </div>
                      <div
                        data-sel
                        onPointerDown={() => setSelCell(`e${i}`)}
                        className={cx(
                          "min-w-0 border-t border-slate-200 pt-2 text-sm text-slate-600 md:border-t-0 md:border-l md:pt-0 md:pl-3",
                          selCell && selCell !== `e${i}` && "select-none",
                        )}
                      >
                        <span className="block text-[11px] font-medium tracking-wide text-slate-400 uppercase select-none">Expected</span>
                        {many?.expected && <StepText text={many.expected} marks={step.vals} className="block whitespace-pre-wrap wrap-anywhere" />}
                        {many ? (
                          <ul className="divide-y divide-slate-100" aria-label={`Step ${step.number} checks`}>
                            {(() => {
                              let k = -1;
                              return many.lines.map((line, li) => {
                                if ("label" in line)
                                  return (
                                    <li key={li} className="pt-2 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                                      {line.label}
                                    </li>
                                  );
                                const c = ++k;
                                const r = checkResults[i][c];
                                const here = current === i && curCheck === c;
                                return (
                                  <li key={li} className={cx("flex flex-wrap items-center gap-2 py-1 text-sm", here && "-mx-1 rounded bg-accent-50 px-1")}>
                                    <span data-sel className="min-w-0 flex-1 text-slate-800 wrap-anywhere">
                                      {line.text}
                                    </span>
                                    <span className="flex shrink-0 gap-0.5 select-none" role="group" aria-label={`Check: ${line.text}`}>
                                      {SETTABLE.map(({ status, key }) => (
                                        <button
                                          key={status}
                                          type="button"
                                          title={STATUS_LABEL[status]}
                                          aria-label={STATUS_LABEL[status]}
                                          aria-pressed={r === status}
                                          disabled={runClosed}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCurrent(i);
                                            setCurCheck(c);
                                            setCheck(i, c, status);
                                          }}
                                          className={cx(
                                            "h-6 w-6 rounded text-[11px] font-semibold ring-1 ring-inset transition",
                                            r === status ? cx(STATUS_STYLE[status].solid, "ring-transparent") : "bg-surface text-slate-500 ring-slate-200 hover:bg-slate-50",
                                          )}
                                        >
                                          {key.toUpperCase()}
                                        </button>
                                      ))}
                                    </span>
                                  </li>
                                );
                              });
                            })()}
                          </ul>
                        ) : step.expected ? (
                          <StepText text={step.expected} marks={step.vals} className="whitespace-pre-wrap wrap-anywhere" />
                        ) : step.titleOnly ? (
                          <span data-testid="title-only-hint" className="text-slate-400 italic">
                            Works as described.
                          </span>
                        ) : (
                          "–"
                        )}
                      </div>
                      <div className="min-w-0 md:col-start-2 md:border-l md:border-slate-200 md:pl-3">
                        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-dashed border-slate-200 pt-2 select-none" role="group" aria-label={`Step ${step.number} status`} data-howto="runner-status">
                          {SETTABLE.map(({ status }) => (
                            <button
                              key={status}
                              type="button"
                              title={`${STATUS_LABEL[status]}: ${STATUS_HELP[status]}`}
                              aria-pressed={s === status}
                              data-howto={status === "FAILED" ? "runner-fail" : undefined}
                              disabled={runClosed}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrent(i);
                                setStep(i, status);
                                if (status === "FAILED") setReveal((r) => ({ i, focus: true, n: (r?.n ?? 0) + 1 }));
                              }}
                              className={cx(
                                "inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium ring-1 ring-inset transition",
                                s === status ? cx(STATUS_STYLE[status].solid, "ring-transparent") : "bg-surface text-slate-600 ring-slate-200 hover:bg-slate-50",
                              )}
                            >
                              <StatusIcon status={status} />
                              {STATUS_LABEL[status]}
                            </button>
                          ))}
                          {s !== "UNTESTED" && !runClosed && (
                            <button
                              type="button"
                              aria-label={`Clear step ${step.number}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrent(i);
                                setStep(i, "UNTESTED");
                              }}
                              className="h-7 px-1.5 text-xs text-slate-500 underline hover:text-slate-800"
                            >
                              Clear
                            </button>
                          )}
                          {many && (
                            <span className="basis-full text-[11px] text-slate-500">
                              {marked === many.count ? "Set from its checks" : `${marked} of ${many.count} checks`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {(problem || actuals[i] || stepDefects.length > 0 || stepFiles.length > 0 || recorder.rec?.stepIndex === i) && (
                    <div className="mt-3 space-y-2 pl-12" data-problem-box>
                      {s === "FAILED" && regression && regression.passed.length === n && regression.passed[i] && (
                        <RegressionNote
                          projectId={projectId}
                          entryId={entry.id}
                          label={regression.label}
                          when={regression.when}
                          off={regression.off}
                          onReport={runClosed ? undefined : () => setBugFor(i)}
                          onShow={() => window.dispatchEvent(new CustomEvent<string>(SHOW_HISTORY_EVENT, { detail: regression.resultId }))}
                        />
                      )}
                      {sentry[i] && (s === "FAILED" || s === "BLOCKED") && (
                        <SentryStepBox
                          data={sentry[i]}
                          canFile={!runClosed}
                          onPick={(ids) => setSentry((x) => ({ ...x, [i]: { ...x[i], picked: ids } }))}
                          onFile={() => setBugFor(i)}
                        />
                      )}
                      <Textarea
                        rows={2}
                        aria-label={`Step ${step.number} actual result`}
                        data-howto="runner-actual"
                        placeholder="What actually happened?"
                        value={actuals[i]}
                        onChange={(e) => setActuals((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant={s === "FAILED" ? "primary" : "secondary"} onClick={() => setBugFor(i)} disabled={runClosed} data-howto="runner-report-bug">
                          {jiraConnected ? "Report bug in Jira" : "Report bug"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={uploading || runClosed}
                          onClick={() => {
                            uploadStep.current = i;
                            fileInput.current?.click();
                          }}
                        >
                          {uploading ? "Uploading…" : "Attach file"}
                        </Button>
                        {captureButtons(i)}
                        {stepDefects.map((d) => (
                          <DefectChip key={d.defect.id} d={d.defect} onRemove={() => setDefects((all) => all.filter((x) => x !== d))} />
                        ))}
                        {stepFiles.map((a) => (
                          <FileChip key={a.id} a={a} onRemove={() => setAttachments((all) => all.filter((x) => x.id !== a.id))} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {data && activeRow !== null && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {activeRow < data.rows.length - 1 ? (
              <Button size="sm" variant="primary" onClick={() => goRow(activeRow + 1)}>
                Next row ({activeRow + 2} of {data.rows.length})
              </Button>
            ) : (
              <span className="text-slate-600">This is the last row.</span>
            )}
            {activeRow > 0 && (
              <Button size="sm" onClick={() => goRow(activeRow - 1)}>
                Back to row {activeRow}
              </Button>
            )}
            <span className="text-slate-600" data-testid="test-data-rows-line">
              {rowsLine(rowStatuses)}
              {rowStatuses.some((x) => x === "FAILED") && `, ${rowStatuses.filter((x) => x === "FAILED").length} failed`}
              {rowStatuses.some((x) => x === "UNTESTED" || x === "IN_PROGRESS") && `, ${rowStatuses.filter((x) => x === "UNTESTED" || x === "IN_PROGRESS").length} not finished`}. The case passes only when every row passes.
            </span>
          </div>
        )}
        {n === 0 && <p className="rounded-lg border border-dashed border-slate-300 bg-surface p-6 text-center text-sm text-slate-500">This case has no steps. Set the case result below.</p>}

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void upload(files, uploadStep.current);
          }}
        />
      </div>

      <div className="mt-3 shrink-0 rounded-lg border border-slate-200 bg-surface p-3 shadow-sm">
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Case result</span>
          {n > 0 && !override && !changingResult && (
            <>
              {caseStatus === "UNTESTED" ? (
                <span className="text-sm text-slate-500">
                  {(stepCounts.UNTESTED ?? 0) === resultSteps.length ? "Mark the steps above" : `${stepCounts.UNTESTED} ${stepCounts.UNTESTED === 1 ? "step" : "steps"} left`}
                </span>
              ) : (
                <StatusChip status={caseStatus} solid />
              )}
              <span className="text-xs text-slate-500">
                {data ? `from rows: ${rowsLine(rowStatuses)}${rowStatuses.some((x) => x === "FAILED") ? `, ${rowStatuses.filter((x) => x === "FAILED").length} failed` : ""}` : `${Object.keys(stepCounts).some((k) => k !== "UNTESTED") ? "from steps: " : ""}${
                  Object.entries(stepCounts)
                    .filter(([k]) => k !== "UNTESTED")
                    .map(([k, v]) => `${v} ${STATUS_LABEL[k as ResultStatus].toLowerCase()}`)
                    .join(", ") || "no steps marked yet"
                }`}
              </span>
              {firstFailed >= 0 && (
                <button
                  type="button"
                  className="text-xs text-accent-700 hover:underline"
                  onClick={() => {
                    setCurrent(firstFailed);
                    setReveal((r) => ({ i: firstFailed, focus: false, n: (r?.n ?? 0) + 1 }));
                  }}
                >
                  Go to {labelOfStep(entry.steps[firstFailed]).toLowerCase()}
                </button>
              )}
              {!runClosed && (
                <button type="button" className="text-xs text-accent-700 hover:underline" onClick={() => setChangingResult(true)}>
                  Pick the result yourself
                </button>
              )}
            </>
          )}
          {(n === 0 || override || changingResult) && SETTABLE.map(({ status }) => (
            <button
              key={status}
              type="button"
              disabled={runClosed}
              onClick={() => setOverride(override === status ? null : status)}
              className={cx(
                "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset",
                caseStatus === status ? cx(STATUS_STYLE[status].solid, "ring-transparent") : "bg-surface text-slate-600 ring-slate-200 hover:bg-slate-50",
              )}
            >
              <StatusIcon status={status} />
              {STATUS_LABEL[status]}
            </button>
          ))}
          {n > 0 && (override || changingResult) && (
            <button
              type="button"
              className="text-xs text-accent-700 hover:underline"
              onClick={() => {
                setOverride(null);
                setChangingResult(false);
              }}
            >
              Use the steps&apos; result{derived !== "UNTESTED" && ` (${STATUS_LABEL[derived]})`}
            </button>
          )}
          {data && override && derived !== "UNTESTED" && override !== derived && (
            <span className="w-full text-xs text-amber-800" data-testid="rows-disagree">
              You set this by hand. The rows say {STATUS_LABEL[derived]}.
            </span>
          )}
        </div>
        {/* The comment gets its own full-width line, with the case buttons under it (ver_87: it used to shrink to a few letters). */}
        <div className="mt-3 grid gap-2">
          <Textarea
            rows={1}
            placeholder="Comment on this case (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Comment"
            data-howto="runner-comment"
            className={cx("min-h-9 resize-none transition-[min-height] focus:min-h-20", comment.includes("\n") && "min-h-20")}
          />
          <div className="flex flex-wrap items-start gap-2">
            <Button size="sm" onClick={() => setBugFor(null)} disabled={runClosed}>
              Report bug for case
            </Button>
            <Button
              size="sm"
              disabled={uploading || runClosed}
              onClick={() => {
                uploadStep.current = null;
                fileInput.current?.click();
              }}
              data-howto="runner-attach"
            >
              Attach file to case
            </Button>
            {captureButtons(null)}
          </div>
        </div>
        {(defects.some((d) => d.stepIndex === null) || attachments.some((a) => a.stepIndex === null)) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {defects
              .filter((d) => d.stepIndex === null)
              .map((d) => (
                <DefectChip key={d.defect.id} d={d.defect} onRemove={() => setDefects((all) => all.filter((x) => x !== d))} />
              ))}
            {attachments
              .filter((a) => a.stepIndex === null)
              .map((a) => (
                <FileChip key={a.id} a={a} onRemove={() => setAttachments((all) => all.filter((x) => x.id !== a.id))} />
              ))}
          </div>
        )}
        {askSkip && (
          <div role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p>
              <span className="font-medium">{entry.caseKey} has no result yet.</span> {n === 1 ? "Its step is" : `All ${n} steps are`} still Untested.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setAskSkip(false);
                  applyStatuses(statuses.map((_, i) => (heading(i) ? "UNTESTED" : "PASSED")));
                  setPassThenNext(true);
                }}
              >
                Pass all and next
              </Button>
              <Button size="sm" onClick={() => submit(true, true)}>
                Leave it for later
              </Button>
              <Button size="sm" onClick={() => setAskSkip(false)}>
                Stay here
              </Button>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-slate-400">
            <span role="status" className={cx("mr-2", saveState === "error" ? "text-red-600" : "text-slate-500")}>
              {saveState === "saving" || saveState === "waiting"
                ? "Saving…"
                : saveState === "saved"
                  ? "Step results saved"
                  : saveState === "error"
                    ? "Couldn't save step results."
                    : ""}
            </span>
            <span className="fp-keyhint">
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves and opens the next case
            </span>
          </span>
          <Button disabled={saving || runClosed} onClick={() => submit(false)}>
            {partial ? "Save progress" : "Save"}
          </Button>
          <Button variant="primary" disabled={saving || runClosed} onClick={() => submit(true)} data-howto="runner-save">
            {/* One name all through a run (ver_187): it used to switch between four. */}
            {saving ? "Saving…" : nextEntryId ? "Save and next" : "Save and finish"}
          </Button>
        </div>
      </div>

      {lastCase && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="flex-1">That was the last case in this run. Every case has a result.</span>
          <Button size="sm" onClick={() => setLastCase(null)}>
            Stay here
          </Button>
          {canCloseRun ? (
            <CloseRunButton projectId={projectId} runId={lastCase} onClosed={() => router.push(`/p/${projectKey}/runs/${runNumber}`)} />
          ) : (
            <Link href={`/p/${projectKey}/runs/${runNumber}`} className={buttonClass("primary", "sm")}>
              Back to the run
            </Link>
          )}
        </div>
      )}

      <RecordingBar r={recorder} />
      {preview && !recorder.rec && (
        <RecordingPreview
          {...preview}
          label={stepLabel(preview.stepIndex)}
          onClose={() => setPreview(null)}
          onRemove={() => {
            setAttachments((all) => all.filter((x) => x.id !== preview.id));
            setPreview(null);
          }}
          onRerecord={() => {
            setAttachments((all) => all.filter((x) => x.id !== preview.id));
            record(preview.stepIndex);
          }}
        />
      )}

      <BugDialog
        open={bugFor !== undefined}
        onClose={() => setBugFor(undefined)}
        onLinked={(d) => {
          const stepIndex = bugFor ?? null;
          setDefects((all) => (all.some((x) => x.defect.id === d.id && x.stepIndex === stepIndex) ? all : [...all, { defect: d, stepIndex }]));
          if (stepIndex !== null && statuses[stepIndex] === "UNTESTED") setStep(stepIndex, "FAILED");
          // The new chip sat under the Case result bar (ver_187): bring it into view once it's drawn.
          setTimeout(() => document.querySelector(`${stepIndex === null ? "" : `[data-step="${stepIndex}"] `}[data-defect-chip="${d.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
        }}
        projectId={projectId}
        entryId={entry.id}
        stepIndex={bugFor ?? null}
        known={bugFor === undefined ? [] : knownBugs.filter((b) => b.state !== "expected" && b.stepIndex === (bugFor ?? null) && checks[b.id] !== "still")}
        onKnownStill={(b) => checkKnown(b, "still")}
        stepLabel={bugFor === null || bugFor === undefined ? "whole case" : labelOfStep(entry.steps[bugFor]).toLowerCase()}
        actual={bugFor === null || bugFor === undefined ? caseBug.actual : actuals[bugFor]}
        suggested={bugFor === null || bugFor === undefined ? caseBug.suggested : withRow(bugTitle(entry.title, entry.steps[bugFor] ?? null, actuals[bugFor] ?? ""), bugFor)}
        focus={bugFor === null ? caseBug.focus : null}
        attachments={attachments.filter((a) => (bugFor === null ? true : a.stepIndex === bugFor)).map((a) => ({ ...a, label: fileLabel(a.stepIndex) }))}
        others={attachments.filter((a) => bugFor !== null && a.stepIndex !== bugFor).map((a) => ({ ...a, label: fileLabel(a.stepIndex) }))}
        captureName={captureName(bugFor ?? null)}
        onUploaded={(a) => setAttachments((all) => [...all, { ...a, stepIndex: bugFor ?? null }])}
        jiraConnected={jiraConnected}
        recent={recent}
        caseRecording={recorder}
        sentryOn={sentryOn}
        sentryErrors={bugFor === undefined ? [] : sentryPicked(bugFor)}
        stories={entry.stories}
        linkStories={entry.linkStories}
        regression={
          regression && !regression.off && bugFor !== undefined && (bugFor === null ? regression.passed.some((p, i) => p && statuses[i] === "FAILED") : regression.passed.length === n && !!regression.passed[bugFor])
            ? { label: regression.jiraLabel, against: regression.label }
            : null
        }
      />
    </div>
  );
}

export function DefectChip({ d, onRemove }: { d: LinkedDefect; onRemove: () => void }) {
  return (
    <span data-defect-chip={d.id} className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs text-red-800 ring-1 ring-red-200 ring-inset">
      {d.externalUrl ? (
        <a href={d.externalUrl} target="_blank" rel="noreferrer" className="font-mono font-medium hover:underline">
          {d.externalKey}
        </a>
      ) : (
        <span className="font-mono">D-{d.number}</span>
      )}
      <span className="max-w-48 truncate">{d.title}</span>
      <button type="button" aria-label="Unlink bug" className="text-red-400 hover:text-red-800" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

export function FileChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
      {a.contentType.startsWith("image/") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/attachments/${a.id}`} alt="" className="h-5 w-5 rounded object-cover" />
      )}
      {a.contentType.startsWith("video/") && <span aria-hidden>🎥</span>}
      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="max-w-40 truncate hover:underline">
        {a.fileName}
      </a>
      <button type="button" aria-label="Remove attachment" className="text-slate-400 hover:text-slate-800" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

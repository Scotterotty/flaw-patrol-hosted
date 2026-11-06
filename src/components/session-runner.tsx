"use client";

import { PaneResizer } from "@/components/pane-resizer";
import { dateTime } from "@/lib/spelling";
import { count } from "@/lib/format";
import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ComponentProps } from "react";
import type { CaseFlagInfo } from "@/lib/case-flag";
import { clock, NOTE_KINDS, NOTE_LABEL, noteCounts, type Charter, type LogKind, type NoteKind, type PersonaInfo, type Reminder, type SessionNote } from "@/lib/charter";
import { holdLive } from "@/lib/live-hold";
import type { Draft } from "@/lib/run-draft";
import { STATUS_LABEL } from "@/lib/status";
import type { LinkedDefect } from "@/server/jira";
import { saveDraft, submitResult, uploadAttachment } from "@/server/results";
import { showQuestMoments } from "./quest-toast";
import { TypeBadge } from "./badges";
import { BugDialog } from "./bug-dialog";
import { useSpelling, useZone } from "./spelling";
import { CaseFlagButton } from "./case-flag";
import { CharterView } from "./charter-view";
import { DefectChip, FileChip } from "./runner";
import { ReminderBanner, SessionReminders, useReminderAlerts } from "./reminders";
import { StatusChip } from "./status";
import { TakeCase } from "./take-case";
import { Button, cx, ErrorText, InfoTip, Textarea } from "./ui";

type Attachment = SessionNote["attachments"][number];

export type SessionEntry = {
  id: string;
  caseKey: string;
  caseNumber: number;
  /** The project the case lives in: an umbrella's library, for shared cases. */
  caseProjectKey?: string;
  caseId: string;
  flag: CaseFlagInfo | null;
  caseVersion: number;
  title: string;
  preconditions: string;
  charter: Charter;
  persona: PersonaInfo | null;
  status: ResultStatus;
  draft: Draft | null;
  draftBy: { name: string; ago: string; mine: boolean } | null;
};

export type PreviousSession = { status: ResultStatus; testerName: string; createdAt: string; comment: string; elapsedSec: number | null; notes: SessionNote[] };


const KIND_STYLE: Record<LogKind, string> = {
  covered: "text-accent-700",
  note: "text-slate-500",
  bug: "text-red-700",
  question: "text-amber-700",
  idea: "text-emerald-700",
};

let seq = 0;
const noteId = () => `n${Date.now().toString(36)}${(++seq).toString(36)}`;

/**
 * An exploratory session: a timer counting down the charter's time box, the
 * mission beside it, and a log of what the tester tried and found. Ending the
 * session asks how it went and saves it to the run like a case result.
 */
export function SessionRunner({
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
  take = null,
}: {
  /** Who's on this session. Its bar sits above the charter and scrolls with it, and also says when you picked up a half-done session (ver_54 audit #1). */
  take?: Omit<ComponentProps<typeof TakeCase>, "session" | "resume"> | null;
  projectId: string;
  projectKey: string;
  runNumber: number;
  runClosed: boolean;
  entry: SessionEntry;
  nextEntryId: string | null;
  keepQuery?: string;
  previous: PreviousSession | null;
  jiraConnected: boolean;
  runDefects: LinkedDefect[];
}) {
  const router = useRouter();
  const draft = entry.draft;
  // Only say "picked up where … left off" when the session opened half done, not after your own autosave.
  const resumed = useRef(draft !== null).current;
  const limit = entry.charter.minutes * 60;
  const [notes, setNotes] = useState<SessionNote[]>(draft?.notes ?? []);
  const [kind, setKind] = useState<NoteKind>("note");
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([]);
  const [summary, setSummary] = useState(draft?.comment ?? "");
  const [outcome, setOutcome] = useState<ResultStatus | null>(draft?.override ?? null);
  const [ending, setEnding] = useState(false);
  const [bugFor, setBugFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  // Saved and on the way to the next case: stays busy until it opens.
  const [leaving, setLeaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The clock only runs while the session is on. Coming back to a half-done
  // session shows it paused where it was left.
  const base = useRef(draft?.elapsedSec ?? 0);
  const since = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(base.current);
  const now = useCallback(() => base.current + (since.current ? Math.floor((Date.now() - since.current) / 1000) : 0), []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(now()), 1000);
    return () => clearInterval(t);
  }, [running, now]);
  const play = useCallback(() => {
    if (since.current) return;
    since.current = Date.now();
    setRunning(true);
  }, []);
  const pause = useCallback(() => {
    base.current = now();
    since.current = null;
    setRunning(false);
    setElapsed(base.current);
  }, [now]);
  const started = elapsed > 0 || running || notes.length > 0;
  // Said in the take bar until the clock moves again (ver_54 audit #1).
  const resumeText =
    resumed && draft && entry.draftBy && !ending && !running && elapsed === draft.elapsedSec
      ? `Picked up where ${entry.draftBy.mine ? "you" : entry.draftBy.name} left off ${entry.draftBy.ago}, timer paused at ${clock(draft.elapsedSec)}.`
      : null;

  // Reminders go off by the session clock: the charter's, plus the tester's own for this session.
  const [ownReminders, setOwnReminders] = useState<Reminder[]>(draft?.reminders ?? []);
  const allReminders = useMemo(() => [...entry.charter.reminders, ...ownReminders], [entry.charter.reminders, ownReminders]);
  const reminders = useReminderAlerts(allReminders, elapsed);
  const noteBox = useRef<HTMLTextAreaElement>(null);

  // Autosave, like the step runner: the log, outcome and summary save shortly
  // after each change, and the clock every half minute while it runs.
  const [saveState, setSaveState] = useState<"idle" | "waiting" | "saving" | "saved" | "error">(draft ? "saved" : "idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<unknown> | null>(null);
  const finished = useRef(false);
  const payload = (): Draft => ({
    stepResults: [],
    override: outcome as Draft["override"],
    comment: summary,
    elapsedSec: now(),
    attachments: [],
    defects: notes.filter((n) => n.defect).map((n) => ({ stepIndex: null, defect: n.defect! })),
    notes,
    reminders: ownReminders,
  });
  const latest = useRef(payload);
  latest.current = payload;
  const content = JSON.stringify({ notes, summary, outcome, reminders: ownReminders });
  const savedContent = useRef(content);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (finished.current || runClosed) return;
    const body = latest.current();
    savedContent.current = JSON.stringify({ notes: body.notes, summary: body.comment, outcome: body.override, reminders: body.reminders });
    setSaveState("saving");
    const p = saveDraft(projectId, entry.id, body).then((res) => {
      if (inflight.current === p) inflight.current = null;
      if (finished.current) return;
      setSaveState(res.ok ? "saved" : "error");
      if (!res.ok) setError(res.error);
    });
    inflight.current = p;
  }, [projectId, entry.id, runClosed]);
  useEffect(() => {
    if (runClosed || finished.current || content === savedContent.current) return;
    setSaveState("waiting");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [content, runClosed, flush]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(flush, 30_000);
    return () => clearInterval(t);
  }, [running, flush]);
  // Pausing saves the clock straight away; so does leaving the page.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) flush();
    wasRunning.current = running;
  }, [running, flush]);
  useEffect(() => () => void ((timer.current || since.current) && flush()), [flush]);
  useEffect(() => {
    if (!(running || saveState === "waiting" || saveState === "saving" || saveState === "error")) return;
    const warn = (e: BeforeUnloadEvent) => {
      flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, saveState, flush]);
  useEffect(() => (started ? holdLive() : undefined), [started]);

  const upload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        const res = await uploadAttachment(projectId, form);
        if (res.ok) setPendingFiles((a) => [...a, { id: res.attachment.id, fileName: res.attachment.fileName, contentType: res.attachment.contentType, size: res.attachment.size }]);
        else setError(res.error);
      }
      setUploading(false);
    },
    [projectId],
  );

  // Paste a screenshot anywhere to add it to the note being written.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (runClosed || ending) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void upload(files.map((f) => new File([f], f.name && f.name !== "image.png" ? f.name : `session-${clock(now()).replace(/:/g, "-")}.png`, { type: f.type })));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload, runClosed, ending, now]);

  const add = () => {
    if (!text.trim() && !pendingFiles.length) return;
    play();
    const note: SessionNote = { id: noteId(), at: now(), kind, text: text.trim(), attachments: pendingFiles, defect: null };
    setNotes((all) => [...all, note]);
    setText("");
    setPendingFiles([]);
    setError(null);
    // A new bug goes straight to the bug form, with the note as what happened.
    if (kind === "bug") setBugFor(note.id);
  };

  const counts = noteCounts(notes);
  const left = limit - elapsed;
  const over = left < 0;
  const bugNote = notes.find((n) => n.id === bugFor) ?? null;
  const linkedIds = new Set(notes.map((n) => n.defect?.id).filter(Boolean));

  const end = () => {
    pause();
    setEnding(true);
  };

  // Finish exploring: no pass or fail. Explored, or Blocked when something stopped you.
  const blocked = outcome === "BLOCKED";
  const save = (goNext: boolean) => {
    if (leaving) return;
    setError(null);
    const base = `/p/${projectKey}/runs/${runNumber}`;
    start(async () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      finished.current = true;
      await inflight.current;
      const res = await submitResult(projectId, entry.id, {
        status: blocked ? "BLOCKED" : "EXPLORED",
        stepResults: [],
        comment: summary,
        elapsedSec: now(),
        attachmentIds: notes.flatMap((n) => n.attachments.map((a) => a.id)),
        defects: notes.filter((n) => n.defect).map((n) => ({ existingId: n.defect!.id, stepIndex: null })),
        sessionLog: notes,
      });
      if (!res.ok) {
        finished.current = false;
        return setError(res.error);
      }
      showQuestMoments(res.quest);
      // Plain Save stays on this session; the refresh reloads it with the saved result.
      // Opened just after the save, so Next.js loads the next case once, not twice.
      if (goNext) {
        setLeaving(true);
        setTimeout(() => {
          router.push(nextEntryId ? `${base}/execute?entry=${nextEntryId}${keepQuery}` : base);
          // The run page may be kept from earlier, so it's refreshed; the next case loads fresh.
          if (!nextEntryId) router.refresh();
        }, 0);
      } else router.refresh();
    });
  };

  return (
    <div className="min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1 bigtext:overflow-visible bigtext:pr-0">
      {take ? (
        <div className="mb-3">
          <TakeCase {...take} session resume={resumeText ? { text: resumeText, onResume: running || runClosed ? undefined : play } : null} />
        </div>
      ) : (
        resumeText && <p className="mb-3 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{resumeText}</p>
      )}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            <Link href={`/p/${entry.caseProjectKey ?? projectKey}/cases/${entry.caseNumber}`} className="font-mono hover:underline" target="_blank">
              {entry.caseKey}
            </Link>{" "}
            · version {entry.caseVersion}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{entry.title}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <TypeBadge type="EXPLORATORY" />
          <CaseFlagButton projectId={projectId} projectKey={projectKey} caseId={entry.caseId} flag={entry.flag} runNumber={runNumber} />
          <StatusChip status={entry.status} />
        </div>
      </div>

      {/* Phones and narrow windows (ver_54 audit #12): the timer panel sits below the log, so a small bar keeps time in view. */}
      {!ending && (
        <div data-testid="phone-timer" className="sticky top-12 z-30 mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-3 py-2 shadow-sm lg:top-0 xl:hidden">
          <span className={cx("text-xl font-semibold tabular-nums", over ? "text-orange-700" : "text-slate-900")}>{over ? `+${clock(-left)}` : clock(left)}</span>
          <span className="text-xs text-slate-500">{over ? "over" : "left"}</span>
          <span className="ml-auto flex gap-2">
            {running ? (
              <Button size="sm" onClick={pause} aria-label="Pause the timer">
                Pause
              </Button>
            ) : (
              <Button size="sm" disabled={runClosed} onClick={play} aria-label={started ? "Keep exploring from the timer bar" : "Start exploring from the timer bar"}>
                {started ? "Resume" : "Start"}
              </Button>
            )}
            {started && (
              <Button size="sm" variant="primary" disabled={runClosed} onClick={end} aria-label="Finish exploring from the timer bar">
                Finish
              </Button>
            )}
          </span>
        </div>
      )}
      {runClosed && <p className="mb-3 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">This run is closed. Reopen it to keep exploring.</p>}
      {previous && !draft && <PreviousSessionNote previous={previous} />}
      {!ending &&
        reminders.alerts.map((a) => (
          <ReminderBanner
            key={a.key}
            alert={a}
            onDone={() => reminders.dismiss(a.key)}
            onLog={() => {
              reminders.dismiss(a.key);
              setKind("note");
              setText((t) => t || `${a.reminder.text || "Reminder"}: `);
              setTimeout(() => noteBox.current?.focus(), 0);
            }}
          />
        ))}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>

      <div className="grid gap-4 xl:grid-cols-[1fr_var(--fp-pane,20rem)]">
        <div className="min-w-0">
          {ending ? (
            <section aria-labelledby="session-result-heading" className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="session-result-heading" className="text-sm font-semibold text-slate-900">
                  Finish exploring
                </h2>
                <span className="text-xs text-slate-500 tabular-nums">
                  {elapsed > 0 && elapsed < 60 ? "Under 1" : Math.round(elapsed / 60)} of {Math.round(limit / 60)} min used
                </span>
              </div>
              <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {NOTE_KINDS.map((k) => (
                  <span key={k} className={cx("rounded-full bg-slate-100 px-2 py-0.5", KIND_STYLE[k])}>
                    <b className="tabular-nums">{counts[k]}</b> {NOTE_LABEL[k].toLowerCase()}
                    {counts[k] === 1 ? "" : "s"}
                  </span>
                ))}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                  <b className="tabular-nums">{notes.reduce((n, x) => n + x.attachments.length, 0)}</b> files
                </span>
                {entry.charter.prompts.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-accent-700">
                    <b className="tabular-nums">{entry.charter.prompts.filter((p) => notes.some((n) => n.kind === "covered" && n.text === p)).length}</b> of {entry.charter.prompts.length} prompts covered
                  </span>
                )}
              </p>
              <label htmlFor="session-summary" className="mt-4 block text-sm font-medium text-slate-700">
                What did you cover?
              </label>
              <Textarea id="session-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What you tried, what you found, and what you didn't get to" />
              <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1 accent-accent-600" checked={blocked} onChange={(e) => setOutcome(e.target.checked ? "BLOCKED" : null)} />
                <span>
                  Something stopped me
                  <span className="block text-xs text-slate-500">Like a broken build or no test account. It&apos;s marked Blocked so someone can pick it up.</span>
                </span>
              </label>
              <p className="mt-2 text-xs text-slate-500">Saved to the run and this charter&apos;s history. Exploring isn&apos;t a pass or a fail, so it never counts in pass rates.</p>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <SaveState state={saveState} />
                <Button onClick={() => setEnding(false)}>Back to exploring</Button>
                <Button variant="primary" disabled={pending || leaving || runClosed} onClick={() => save(true)} data-howto="charter-finish-save">
                  {pending || leaving ? "Saving…" : "Finish"}
                </Button>
              </div>
            </section>
          ) : (
            <section aria-label="Session log" className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
              <div role="group" aria-label="Kind of note" className="flex flex-wrap gap-1">
                {NOTE_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cx("rounded-full px-3 py-1 text-xs ring-1 ring-inset", kind === k ? "bg-slate-800 font-semibold text-slate-50 ring-slate-800" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}
                  >
                    {NOTE_LABEL[k]}
                  </button>
                ))}
              </div>
              <Textarea
                ref={noteBox}
                className="mt-2"
                rows={2}
                aria-label="New note"
                data-howto="charter-log"
                disabled={runClosed}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder={kind === "bug" ? "What went wrong?" : kind === "question" ? "What do you need to ask?" : kind === "idea" ? "What else is worth testing?" : "What did you try or notice?"}
              />
              {pendingFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingFiles.map((a) => (
                    <FileChip key={a.id} a={{ ...a, stepIndex: null }} onRemove={() => setPendingFiles((all) => all.filter((x) => x.id !== a.id))} />
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  <span className="fp-keyhint">
                    <kbd>Enter</kbd> adds it · paste a screenshot to attach it
                  </span>
                  {jiraConnected && " · bugs can go to Jira"}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" disabled={uploading || runClosed} onClick={() => fileInput.current?.click()}>
                    {uploading ? "Uploading…" : "Attach file"}
                  </Button>
                  <Button size="sm" variant="primary" disabled={runClosed || (!text.trim() && !pendingFiles.length)} onClick={add}>
                    Add to log
                  </Button>
                </span>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) void upload(files);
                }}
              />

              {notes.length === 0 ? (
                <p className="mt-4 rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  {started ? "Nothing logged yet." : "Press Start exploring, then log what you try and find as you go."}
                </p>
              ) : (
                <ol aria-label="Log" className="mt-3 divide-y divide-slate-100">
                  {[...notes].reverse().map((n) => (
                    <li key={n.id} className="flex gap-3 py-2 text-sm">
                      <span className="w-12 shrink-0 pt-0.5 text-xs text-slate-400 tabular-nums">{clock(n.at)}</span>
                      <span className={cx("w-16 shrink-0 pt-0.5 text-[11px] font-bold tracking-wide uppercase", KIND_STYLE[n.kind])}>{NOTE_LABEL[n.kind]}</span>
                      <span className="min-w-0 flex-1">
                        {n.text && <span className="block whitespace-pre-wrap wrap-anywhere text-slate-800">{n.text}</span>}
                        {(n.attachments.length > 0 || n.defect || n.kind === "bug") && (
                          <span className="mt-1 flex flex-wrap items-center gap-2">
                            {n.attachments.map((a) => (
                              <FileChip
                                key={a.id}
                                a={{ ...a, stepIndex: null }}
                                onRemove={() => setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, attachments: x.attachments.filter((y) => y.id !== a.id) } : x)))}
                              />
                            ))}
                            {n.defect ? (
                              <DefectChip d={n.defect} onRemove={() => setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, defect: null } : x)))} />
                            ) : (
                              n.kind === "bug" &&
                              !runClosed && (
                                <Button size="sm" onClick={() => setBugFor(n.id)}>
                                  {jiraConnected ? "Report bug in Jira" : "Report bug"}
                                </Button>
                              )
                            )}
                          </span>
                        )}
                      </span>
                      {!runClosed && (
                        <button
                          type="button"
                          aria-label={`Remove note from ${clock(n.at)}`}
                          className="self-start text-slate-300 hover:text-slate-700"
                          onClick={() => setNotes((all) => all.filter((x) => x.id !== n.id))}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-2 text-right">
                <SaveState state={saveState} />
              </div>
            </section>
          )}
        </div>

        <aside className="relative space-y-4">
          <PaneResizer id="session-side" label="the side panel" min={224} max={480} target="parent" edge="left" from="xl" />
          <section aria-label="Timer" className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
            <p className="text-xs text-slate-500">{over ? "Over the time limit by" : "Time left"}</p>
            <p role="timer" aria-live="off" className={cx("text-3xl font-semibold tabular-nums", over ? "text-orange-700" : "text-slate-900")}>
              {over ? `+${clock(-left)}` : clock(left)}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
              <div className={cx("h-full rounded-full", over ? "bg-orange-500" : "bg-accent-600")} style={{ width: `${Math.min(100, (elapsed / limit) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {clock(elapsed)} of {clock(limit)}
            </p>
            {!ending && (
              <div className="mt-3 flex flex-wrap gap-2">
                {running ? (
                  <Button size="sm" onClick={pause}>
                    Pause
                  </Button>
                ) : (
                  <Button size="sm" variant={started ? "secondary" : "primary"} disabled={runClosed} onClick={play}>
                    {started ? "Keep exploring" : "Start exploring"}
                  </Button>
                )}
                {started && (
                  <Button size="sm" variant="primary" disabled={runClosed} onClick={end} data-howto="charter-finish">
                    Finish exploring
                  </Button>
                )}
              </div>
            )}
            {!ending && (
              <SessionReminders
                charterReminders={entry.charter.reminders}
                own={ownReminders}
                onChange={setOwnReminders}
                elapsed={elapsed}
                sound={reminders.sound}
                onToggleSound={reminders.toggleSound}
                disabled={runClosed}
              />
            )}
          </section>
          {entry.charter.prompts.length > 0 && (
            <PromptsCard
              prompts={entry.charter.prompts}
              covered={new Set(notes.filter((n) => n.kind === "covered").map((n) => n.text))}
              disabled={runClosed || ending}
              onToggle={(p, on) => {
                if (on) {
                  play();
                  setNotes((all) => [...all, { id: noteId(), at: now(), kind: "covered", text: p, attachments: [], defect: null }]);
                } else setNotes((all) => all.filter((n) => !(n.kind === "covered" && n.text === p)));
              }}
            />
          )}
          <section aria-label="Mission" className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
            <CharterView charter={entry.charter} persona={entry.persona} hidePrompts hideReminders />
            {entry.preconditions && (
              <p className="mt-3 border-t border-slate-100 pt-2 text-sm whitespace-pre-wrap wrap-anywhere text-slate-700">
                <span className="block text-xs font-medium text-slate-500">Setup</span>
                {entry.preconditions}
              </p>
            )}
          </section>
        </aside>
      </div>

      <BugDialog
        open={bugNote !== null}
        onClose={() => setBugFor(null)}
        onLinked={(d) => {
          setNotes((all) => all.map((x) => (x.id === bugFor ? { ...x, defect: d } : x)));
        }}
        projectId={projectId}
        entryId={entry.id}
        stepIndex={null}
        stepLabel={`session note at ${clock(bugNote?.at ?? 0)}`}
        actual={bugNote?.text ?? ""}
        attachments={(bugNote?.attachments ?? []).map((a) => ({ ...a, label: `Note at ${clock(bugNote?.at ?? 0)}` }))}
        others={notes.filter((x) => x.id !== bugFor).flatMap((x) => x.attachments.map((a) => ({ ...a, label: `Note at ${clock(x.at)}` })))}
        captureName={`${entry.caseKey} note ${clock(bugNote?.at ?? 0).replace(":", "-")}`}
        onUploaded={(a) => setNotes((all) => all.map((x) => (x.id === bugFor ? { ...x, attachments: [...x.attachments, a] } : x)))}
        jiraConnected={jiraConnected}
        recent={runDefects.filter((d) => !linkedIds.has(d.id))}
      />
    </div>
  );
}

function SaveState({ state }: { state: "idle" | "waiting" | "saving" | "saved" | "error" }) {
  return (
    <span role="status" className={cx("mr-auto text-xs", state === "error" ? "text-red-600" : "text-slate-500")}>
      {state === "saving" || state === "waiting" ? "Saving…" : state === "saved" ? "Session saved" : state === "error" ? "Couldn't save the session." : ""}
    </span>
  );
}

function PreviousSessionNote({ previous }: { previous: PreviousSession }) {
  const c = noteCounts(previous.notes);
  const spelling = useSpelling();
  const zone = useZone();
  return (
    <div className="mb-4 rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-600">
      Last explored in this run: <StatusChip status={previous.status} /> by {previous.testerName}{" "}
      <span suppressHydrationWarning>{dateTime(new Date(previous.createdAt), spelling, zone)}</span>
      {previous.elapsedSec !== null && ` · ${clock(previous.elapsedSec)}`}
      <span className="block text-xs text-slate-500">
        {count(c.note, "note")}, {count(c.bug, "bug")}, {count(c.question, "question")}, {count(c.idea, "idea")}. Starting again records a new session.
      </span>
      {previous.comment && <span className="block text-xs text-slate-500">“{previous.comment}”</span>}
      <span className="sr-only">{STATUS_LABEL[previous.status]}</span>
    </div>
  );
}

/** Prompts from a tour or checklist: ticking one logs "Covered", so the debrief shows what got looked at. */
export function PromptsCard({ prompts, covered, disabled, onToggle }: { prompts: string[]; covered: Set<string>; disabled?: boolean; onToggle: (prompt: string, on: boolean) => void }) {
  const done = prompts.filter((p) => covered.has(p)).length;
  return (
    <section aria-label="Prompts" className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        Prompts · {done} of {prompts.length}
        <InfoTip text="Things worth trying, from the charter. Ticking one adds a Covered line to the log. They're optional: you can finish with some unticked." />
      </h2>
      <ul className="mt-2 space-y-1">
        {prompts.map((p) => (
          <li key={p}>
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input type="checkbox" className="mt-1" checked={covered.has(p)} disabled={disabled} onChange={(e) => onToggle(p, e.target.checked)} />
              <span className={covered.has(p) ? "text-slate-500 line-through" : undefined}>{p}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

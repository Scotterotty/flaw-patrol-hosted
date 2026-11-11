"use client";

// Write a bug: a bug that isn't from a test case, a run or a bug bash (Scott, Nov 4).
// It opens from the Bugs page, the Overview page, the "+" next to Bugs in the left menu
// and Ctrl+K (all of them land on the Bugs page with ?write=1). Same templates as a bug
// from a run: headings a run would fill in become boxes to type in.

import { JIRA_FILE_LIMIT, mbText, tooBigForJira } from "@/lib/jira-files";
import type { Severity } from "@prisma/client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { buildLine, stamp } from "@/lib/bug-template";
import { CURRENT_ID, deviceCell, nowCell, PLAIN_ID, plainLayout, startAnswers, usualAnswersLine, type Answer, type BugLayout, type UsualAnswers } from "@/lib/bug-layout";
import { defaultSeverityOf, type SeverityScale } from "@/lib/severity";
import { bugTemplateChoices } from "@/server/bug-templates";
import { fileTemplatedBug, startTemplatedBug } from "@/server/jira";
import { uploadAttachment } from "@/server/results";
import { sendWrittenBug, writeBugStart } from "@/server/write-bug";
import { Modal } from "./modal";
import { BugTemplateForm } from "./bug-template-form";
import type { BugCapture } from "./bug-files";
import { draftToOko, okoIntoDraft } from "@/lib/oko-draft";
import { RecordingBar, takeScreenshot, useCaptureSupport, useScreenRecorder } from "./screen-capture";
import type { CurrentLayout } from "@/lib/bug-templates-data";
import { missingLine, TemplatedForm, TemplatePicker, type TemplateChoice, type TemplatedDraft } from "./templated-bug-form";
import { Button, cx, ErrorText, Input, Select } from "./ui";

/** An empty Repro rate, or an empty Repros cell in the Reproduction History row, starts at 1/1. */
function startOneOfOne(a: Answer): Answer {
  if (a.heading === "Repro rate") return a.text ? a : { ...a, text: "1/1" };
  const col = a.columns?.findIndex((c) => c.name.trim().toLowerCase() === "repros") ?? -1;
  if (col < 0 || !a.rows?.[0] || a.rows[0][col]) return a;
  return { ...a, rows: [a.rows[0].map((v, i) => (i === col ? "1/1" : v)), ...a.rows.slice(1)] };
}

/** An empty Build # starts from the Client and CSP boxes' version numbers, as the form does when they change. */
function withBuild(answers: Answer[]): Answer[] {
  const table = answers.find((a) => a.columns && a.rows?.[0]);
  const cell = (name: string) => {
    const i = table?.columns?.findIndex((c) => c.name.trim().toLowerCase() === name) ?? -1;
    return i < 0 ? "" : (table?.rows?.[0][i] ?? "");
  };
  const line = buildLine(cell("client version"), cell("csp"));
  return line ? answers.map((a) => (a.heading === "Build #" && !a.text ? { ...a, text: line } : a)) : answers;
}

export type WriteBugCycle = { id: string; name: string };

/** "Plain" is the built-in choice: three boxes to write in. */
const PLAIN: CurrentLayout = { name: "Plain", kind: "plain" };
/** Listed after the team's templates when the first choice is the test cycle's own layout (like OKO). */
const PLAIN_CHOICE: TemplateChoice = { id: PLAIN_ID, name: "Plain", hint: "Three boxes to write in", layout: plainLayout() };

/**
 * The + Write a bug button and its box. `cycles`: where the bug can go (an umbrella's current
 * test cycles, or just this one); the first is picked to start. `?write=1` opens it on arrival.
 */
export function WriteBugButton({ cycles, scale, variant = "primary" }: { cycles: WriteBugCycle[]; scale: SeverityScale; variant?: "primary" | "secondary" }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // Opened by a link from Overview, the left menu or Ctrl+K.
  const asked = params.get("write") === "1";
  useEffect(() => {
    if (asked) setOpen(true);
  }, [asked]);
  const close = () => {
    setOpen(false);
    // Take ?write=1 off, so going back or refreshing doesn't open it again.
    if (asked) {
      const next = new URLSearchParams(params.toString());
      next.delete("write");
      router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
    }
  };
  if (!cycles.length) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} data-testid="write-bug">
        + Write a bug
      </Button>
      {open && <WriteBugBox cycles={cycles} scale={scale} onClose={close} onSaved={() => router.refresh()} />}
    </>
  );
}

function WriteBugBox({ cycles, scale, onClose, onSaved }: { cycles: WriteBugCycle[]; scale: SeverityScale; onClose: () => void; onSaved: () => void }) {
  const [projectId, setProjectId] = useState(cycles[0].id);
  const [choices, setChoices] = useState<TemplateChoice[]>([]);
  const [chosen, setChosen] = useState("");
  // The first choice: the test cycle's own layout (Settings → Bug templates, first row), or Plain.
  const [first, setFirst] = useState<{ label: CurrentLayout; layout: BugLayout | null }>({ label: PLAIN, layout: null });
  // The choices shown are this test cycle's (no stand-in "Plain" while they load).
  const [loadedFor, setLoadedFor] = useState("");
  const [draft, setDraft] = useState<TemplatedDraft | null>(null);
  const [severity, setSeverity] = useState<Severity>(defaultSeverityOf(scale));
  const [foundIn, setFoundIn] = useState("");
  const [jiraKey, setJiraKey] = useState<string | null>(null);
  const [alsoJira, setAlsoJira] = useState(true);
  const [files, setFiles] = useState<{ id: string; fileName: string; contentType: string; size?: number }[]>([]);
  // The OKO form's file ticks: untick a file to keep it off the bug.
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ key: string; lines: string[] } | null>(null);
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef<TemplatedDraft | null>(null);
  draftRef.current = draft;
  // "Is this bug about Unreal?": the test cycle's usual answers, only when the writer says yes
  // (Scott, Nov 5: you may be in an Unreal umbrella writing up a Unity bug). Start blank until then.
  const [usual, setUsual] = useState<UsualAnswers | null>(null);
  const [useUsual, setUseUsual] = useState(false);
  const usualRef = useRef({ usual, on: useUsual });
  usualRef.current = { usual, on: useUsual };

  /** Switch template: what was typed under a heading with the same name comes along. */
  const pick = (id: string, list: TemplateChoice[], forProject = projectId, top = first) => {
    setChosen(id);
    const layout = id ? list.find((t) => t.id === id)?.layout : (top.layout ?? undefined);
    if (id && !layout) return;
    const templateId = id || (top.layout ? CURRENT_ID : PLAIN_ID);
    startLoad(async () => {
      const res = await startTemplatedBug(forProject, "", null, "", templateId);
      if (!res.ok) return setError(res.error);
      const before = draftRef.current;
      const real = layout ?? plainLayout();
      const typed = new Map((before?.answers ?? []).filter((a) => a.text.trim()).map((a) => [a.heading.trim().toLowerCase(), a] as const));
      const answers = startAnswers(real, res.fill, { ...res.auto, now: real.oko ? stamp() : nowCell(), device: deviceCell(navigator.userAgent) }).map((a) => {
        const old = typed.get(a.heading.trim().toLowerCase());
        return old && !a.rows && !a.files ? { ...a, text: old.text } : a;
      });
      // The OKO form starts Repros and Repro rate at 1/1, as in a run, so the two match from the start.
      const started = real.oko ? withBuild(answers.map(startOneOfOne)) : answers;
      const fresh: TemplatedDraft = { templateId, layout: real, platform: before?.platform ?? "", area: before?.area ?? "", build: before?.build ?? "", summary: before?.summary ?? "", answers: started, fields: res.fields };
      const u = usualRef.current;
      setDraft(templateId === CURRENT_ID && u.usual && u.on ? withUsual(fresh, u.usual, true) : fresh);
    });
  };

  // Each test cycle has its own templates, Jira and release: load them when the box opens or "Goes to" changes.
  useEffect(() => {
    setError(null);
    setFiles([]);
    startLoad(async () => {
      const [s, c] = await Promise.all([writeBugStart(projectId), bugTemplateChoices(projectId)]);
      if (!s.ok) return setError(s.error);
      setFoundIn(s.foundIn);
      setJiraKey(s.jiraKey);
      const top = c.ok && c.currentLayout ? { label: c.current, layout: c.currentLayout } : { label: PLAIN, layout: null };
      const list = [...(c.ok ? c.templates : []), ...(top.layout ? [PLAIN_CHOICE] : [])];
      setFirst(top);
      setUsual(c.ok ? c.presets : null);
      setUseUsual(false);
      usualRef.current = { usual: c.ok ? c.presets : null, on: false };
      setChoices(list);
      setLoadedFor(projectId);
      pick(c.ok && c.defaultId && list.some((t) => t.id === c.defaultId) ? c.defaultId : "", list, projectId, top);
    });
    // Only when the test cycle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Take screenshot / Record screen right here, as in a run's Report a bug box.
  const support = useCaptureSupport();
  const recorder = useScreenRecorder(
    (f) => void upload([f.file]),
    (message) => setError(message),
  );
  const [shooting, setShooting] = useState(false);
  const capturing = shooting || uploading || recorder.rec !== null || recorder.picking;
  const screenshot = async () => {
    setShooting(true);
    try {
      const file = await takeScreenshot("Bug screenshot.png");
      if (file) await upload([file]);
    } catch {
      setError("Couldn't take the screenshot.");
    } finally {
      setShooting(false);
    }
  };
  const capture: BugCapture = {
    ok: support.ok,
    why: support.why,
    busy: capturing,
    area: support.area,
    screenshot: () => void screenshot(),
    record: () => void recorder.start({ stepIndex: null, label: "for this bug", baseName: "Bug" }),
    recordArea: () => void recorder.start({ stepIndex: null, label: "for this bug", baseName: "Bug", area: true }),
  };
  // Closing the box mid-recording throws the recording away.
  const stopRecording = recorder.stop;
  useEffect(() => () => stopRecording(false), [stopRecording]);

  const upload = async (list: FileList | File[] | null) => {
    if (!list?.length) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(list)) {
      const form = new FormData();
      form.set("file", file);
      const res = await uploadAttachment(projectId, form);
      if (res.ok) setFiles((f) => [...f, { id: res.attachment.id, fileName: res.attachment.fileName, contentType: res.attachment.contentType, size: res.attachment.size }]);
      else setError(res.error);
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const toJira = !!jiraKey && alsoJira;
  // Only what this form can fill: Jira fields show when Jira is connected.
  const offer = usual && draft?.templateId === CURRENT_ID ? { ...usual, fields: usual.fields.filter((f) => draft.fields.some((x) => x.name === f.name)) } : null;
  const asked = offer && (offer.tag || offer.fields.length) ? offer : null;
  const gaps = draft ? missingLine(draft, 0) : "";
  const save = () =>
    start(async () => {
      if (!draft) return;
      setError(null);
      const res = await fileTemplatedBug(projectId, "", {
        templateId: draft.templateId,
        summary: draft.summary,
        platform: draft.platform,
        area: draft.area,
        build: draft.build,
        severity,
        stepIndex: null,
        answers: draft.answers,
        attachmentIds: files.filter((f) => !left.has(f.id)).map((f) => f.id),
        fields: Object.fromEntries(draft.fields.map((f) => [f.id, f.value])),
        foundIn: foundIn.trim() || null,
        jira: toJira,
      });
      if (!res.ok) return setError(res.error);
      onSaved();
      const lines = [res.attachError && `${res.defect.externalKey} was created, but attaching files failed: ${res.attachError}`, res.reporterNote].filter((n): n is string => !!n);
      if (!lines.length) return onClose();
      setNotes({ key: res.defect.externalKey ?? `D-${res.defect.number}`, lines });
    });

  return (
    <Modal open onClose={onClose} title="Write a bug" wide>
      {notes ? (
        <div className="space-y-3" data-testid="write-bug-notes">
          <p className="text-sm font-medium text-slate-800">Saved {notes.key}.</p>
          {notes.lines.map((n) => (
            <p key={n} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {n}
            </p>
          ))}
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          data-testid="write-bug-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <RecordingBar r={recorder} inline />
          <p className="text-sm text-slate-600">For a bug you found outside a test: no test case, run or bug bash needed.</p>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {cycles.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="wb-cycle">
                Goes to
              </label>
              <Select id="wb-cycle" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-auto min-w-56 max-w-full">
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {/* Only one template (ver_187): nothing to pick, so no Template row to read. */}
          {!(loadedFor === projectId && choices.length === 0) && (
            <div className="rounded-lg bg-accent-50 px-3 py-2.5" data-howto="write-bug-template">
              {loadedFor === projectId ? (
                <TemplatePicker current={first.label} templates={choices} value={chosen} onChange={(id) => pick(id, choices)} />
              ) : (
                <p className="text-xs text-slate-500">Loading templates…</p>
              )}
            </div>
          )}
          {draft && draft.templateId === (chosen || (first.layout ? CURRENT_ID : PLAIN_ID)) ? (
            <>
              {asked && (
                <div className="space-y-1.5 rounded-lg border border-slate-200 px-3 py-2.5" data-testid="usual-answers" data-howto="write-bug-usual">
                  <p className="text-xs font-medium text-slate-600" id="wb-usual">
                    Is this bug about {asked.about}?
                  </p>
                  <div role="group" aria-labelledby="wb-usual" className="flex flex-wrap gap-1.5">
                    {[
                      { on: true, label: `Yes, use ${asked.about}'s usual answers` },
                      { on: false, label: "No, start blank" },
                    ].map((o) => (
                      <button
                        key={String(o.on)}
                        type="button"
                        aria-pressed={useUsual === o.on}
                        onClick={() => {
                          setUseUsual(o.on);
                          setDraft((d) => (d && usual ? withUsual(d, usual, o.on) : d));
                        }}
                        className={cx("rounded-full border px-3 py-1 text-[13px]", useUsual === o.on ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400")}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    {useUsual ? "Filled in" : "Fills in"}: {usualAnswersLine(asked)}. You can still change each one.
                  </p>
                </div>
              )}
              {draft.layout.oko ? (
                // The same OKO form as a run's Report a bug: one OKO form wherever it appears.
                <BugTemplateForm
                  // Opened again when the test cycle, template or usual answers change, so its tags match what filled the boxes.
                  key={`${projectId}-${draft.templateId}-${useUsual}`}
                  bug={draftToOko(draft)}
                  setBug={(fn) => setDraft((d) => (d ? okoIntoDraft(d, fn(draftToOko(d))) : d))}
                  options={{
                    clients: draft.fields.find((f) => f.name === "Client/SKUs")?.options ?? [],
                    team: draft.fields.find((f) => f.name === "Team")?.options ?? [],
                    olyEnv: draft.fields.find((f) => f.name === "Oly Environment")?.options ?? [],
                  }}
                  severity={severity}
                  setSeverity={setSeverity}
                  scale={scale}
                  files={files.map((f) => ({ ...f, label: "Added here" }))}
                  include={new Set(files.map((f) => f.id).filter((id) => !left.has(id)))}
                  setInclude={(fn) => {
                    const on = fn(new Set(files.map((f) => f.id).filter((id) => !left.has(id))));
                    setLeft(new Set(files.map((f) => f.id).filter((id) => !on.has(id))));
                  }}
                  onAdd={(list) => void upload(list)}
                  uploading={uploading}
                  capture={capture}
                  jiraLimit={toJira ? JIRA_FILE_LIMIT : null}
                  from="written"
                />
              ) : (
                <TemplatedForm projectId={projectId} draft={draft} setDraft={(fn) => setDraft((d) => (d ? fn(d) : d))} severity={severity} setSeverity={setSeverity} scale={scale} setError={setError} />
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="wb-found">
                  Found in <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <Input id="wb-found" value={foundIn} onChange={(e) => setFoundIn(e.target.value)} placeholder="A version, a build or a date" className="max-w-sm" />
              </div>
              <div className={cx("space-y-1.5", draft.layout.oko && "hidden")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                    {uploading ? "Adding…" : "+ Attach files"}
                  </Button>
                  <input ref={fileInput} type="file" multiple hidden aria-label="Attach files" onChange={(e) => void upload(e.target.files)} data-testid="write-bug-files" />
                  <Button type="button" size="sm" onClick={() => void screenshot()} disabled={!support.ok || capturing} title={support.ok ? "Take a picture of a tab, window or screen and add it" : support.why}>
                    📷 Take screenshot
                  </Button>
                  <Button type="button" size="sm" onClick={() => void recorder.start({ stepIndex: null, label: "for this bug", baseName: "Bug" })} disabled={!support.ok || capturing} title={support.ok ? "Record a tab, window or screen for up to 5 minutes and add the video" : support.why}>
                    🎥 Record screen
                  </Button>
                  <span className="text-xs text-slate-500">Screenshots, videos or logs</span>
                </div>
                {files.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {files.map((f) => (
                      <li key={f.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                        {f.fileName}
                        <button type="button" aria-label={`Remove ${f.fileName}`} className="text-slate-400 hover:text-slate-700" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {jiraKey && alsoJira && files.some((f) => tooBigForJira(f.size)) && (
                  <p className="text-xs font-semibold text-amber-800" data-testid="too-big-for-jira">
                    {files
                      .filter((f) => tooBigForJira(f.size))
                      .map((f) => f.fileName)
                      .join(", ")}
                    : too big for Jira ({mbText(JIRA_FILE_LIMIT)} max). It stays on the bug here, and Jira gets the rest.
                  </p>
                )}
              </div>
              {jiraKey && (
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" checked={alsoJira} onChange={(e) => setAlsoJira(e.target.checked)} data-testid="write-bug-jira" />
                  Also file it in Jira ({jiraKey})
                </label>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500" role="status">
              {loading ? "Opening the template…" : "Pick a template."}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {gaps && (
              <span className="text-xs text-amber-800" data-testid="template-missing">
                {gaps}
              </span>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || uploading || loading || !draft || !!gaps} data-howto="write-bug-save">
              {pending ? "Saving…" : toJira ? "Save and file in Jira" : "Save bug"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Fill in (or clear) the usual answers: the title's tag and the Jira fields they name. */
function withUsual(d: TemplatedDraft, u: UsualAnswers, on: boolean): TemplatedDraft {
  const fields = d.fields.map((f) => {
    const p = u.fields.find((x) => x.name === f.name);
    return p ? { ...f, value: on ? p.value : [] } : f;
  });
  const platform = on ? u.tag || d.platform : d.platform === u.tag ? "" : d.platform;
  return { ...d, platform, fields };
}

/** Send to Jira for a written bug: its headings and files go as they are, no box needed. */
export function SendWrittenBugButton({ projectId, defectId }: { projectId: string; defectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        disabled={pending}
        data-howto="bug-send-jira"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await sendWrittenBug(projectId, defectId);
            if (!res.ok) return setError(res.error);
            router.refresh();
          })
        }
      >
        {pending ? "Sending…" : "Send to Jira"}
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

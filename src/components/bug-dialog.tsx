"use client";

import type { SentryRef } from "@/lib/sentry";
import { SentryBugSection } from "./sentry-box";
import type { Severity } from "@prisma/client";
import { useEffect, useState, useTransition } from "react";
import { browserContext, orderFiles, stamp, type TemplateBug } from "@/lib/bug-template";
import { DEFAULT_SEVERITY, defaultSeverityOf, PLAIN_SCALE, type SeverityScale } from "@/lib/severity";
import type { ImportedDraft, LinkedDefect, ReporterInfo } from "@/server/jira";
import type { KnownBug } from "@/lib/known-bugs";
import { importedTitle } from "@/lib/bug-template";
import { createLocalDefect, fileJiraBug, fileTemplatedBug, linkJiraIssue, previewFoundIn, previewJiraBug, previewLocalBug, searchJira, startTemplatedBug } from "@/server/jira";
import type { FoundInDraft } from "@/lib/found-in";
import { FoundInLine } from "./found-in-line";
import { bugTemplateChoices } from "@/server/bug-templates";
import type { CurrentLayout } from "@/lib/bug-templates-data";
import { deviceCell, nowCell, startAnswers, type Answer } from "@/lib/bug-layout";
import { missingLine, TemplatedForm, TemplatePicker, type TemplateChoice, type TemplatedDraft } from "./templated-bug-form";
import { uploadAttachment } from "@/server/results";
import { BugFiles, type BugCapture, type BugFile } from "./bug-files";
import { BugTemplateForm, type TemplateOptions } from "./bug-template-form";
import { PriorityLine } from "./jira-priority";
import { RecordingBar, takeScreenshot, useCaptureSupport, useScreenRecorder } from "./screen-capture";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, InfoTip, Input, Select, Textarea } from "./ui";

/** An imported template being filled in: the draft plus what the tester typed. */
type ImportedBug = ImportedDraft & { summary: string };

type Issue = { key: string; summary: string; status: string; url: string };
type Attached = BugFile;

/**
 * Report a bug for a step (or the whole case): file a new Jira issue with the
 * steps, expected and actual results and screenshots filled in, or link an
 * existing one. Falls back to a local defect when Jira isn't connected.
 */
export function BugDialog({
  open,
  onClose,
  onLinked,
  projectId,
  entryId,
  stepIndex,
  stepLabel,
  actual,
  attachments,
  others = [],
  captureName = "bug",
  onUploaded,
  jiraConnected,
  recent,
  suggested,
  stories = [],
  known = [],
  onKnownStill,
  linkStories = true,
  fromDefect,
  prefill,
  regression = null,
  sentryOn = false,
  sentryErrors = [],
  focus = null,
}: {
  /** A whole-case bug's first failed step (persona audit #4): the bug starts from what failed there. */
  focus?: number | null;
  /** Sentry is connected: + Add offers "Sentry error…". */
  sentryOn?: boolean;
  /** Errors ticked under the step, put on the bug. */
  sentryErrors?: SentryRef[];
  /** A bug already written elsewhere (a bug bash line, ver_94): its title and severity start filled in. */
  prefill?: { title: string; severity: Severity };
  /** Regression flag: the case passed in an earlier release, so the box to mark it in Jira starts ticked. */
  regression?: { label: string; against: string } | null;
  open: boolean;
  onClose: () => void;
  onLinked: (d: LinkedDefect) => void;
  projectId: string;
  entryId: string;
  stepIndex: number | null;
  stepLabel: string;
  actual: string;
  attachments: Attached[];
  /** Files taken elsewhere in this case (other steps, the whole case): offered in + Add ▾ › From this case. */
  others?: Attached[];
  /** The start of a screenshot's or recording's file name, like "APP-12 step 3". */
  captureName?: string;
  /** A file added from the dialog, already uploaded, for the step's evidence too. */
  onUploaded?: (a: Attached) => void;
  jiraConnected: boolean;
  recent: LinkedDefect[];
  /** A title made from the screen, used when Jira isn't connected (Jira's preview makes its own). */
  suggested?: string;
  /** Known bugs on this step: "It's this one" marks it Still happens instead of filing. */
  known?: KnownBug[];
  onKnownStill?: (b: KnownBug) => void;
  /** The case's Jira stories: each gets a "Link to story" tick. */
  stories?: { key: string; title: string }[];
  /** Whether those ticks start ticked (Settings → Jira → Stories). */
  linkStories?: boolean;
  /** Send to Jira: a bug saved before Jira was connected becomes this Jira issue. */
  fromDefect?: { id: string; label: string; title: string; severity: Severity };
}) {
  const [linkTo, setLinkTo] = useState<Set<string>>(new Set());
  // Known bugs the tester said this isn't: the new bug links to them as related instead.
  const [notThis, setNotThis] = useState<string[]>([]);
  const [markReg, setMarkReg] = useState(true);
  const [tab, setTab] = useState<"new" | "link">("new");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  // What happened: without Jira, the bug's own description, filled in and editable.
  const [happened, setHappened] = useState("");
  const [reporter, setReporter] = useState<ReporterInfo | null>(null);
  const [severity, setSeverity] = useState<Severity>(DEFAULT_SEVERITY);
  // The team's severity names, from its Jira.
  const [scale, setScale] = useState<SeverityScale>(PLAIN_SCALE);
  const [jiraPriority, setJiraPriority] = useState<string | null>(null);
  // An imported template's Severity starts on "Choose…": the tester picks it.
  const [sevPicked, setSevPicked] = useState(true);
  const [include, setInclude] = useState<Set<string>>(new Set());
  // The team template, when the project uses it.
  const [template, setTemplate] = useState<TemplateBug | null>(null);
  const [options, setOptions] = useState<TemplateOptions>({ clients: [], team: [], olyEnv: [] });
  // A template imported from an example Jira bug, when the project uses one.
  const [imported, setImported] = useState<ImportedBug | null>(null);
  const [added, setAdded] = useState<Attached[]>([]);
  const [sentryList, setSentryList] = useState<SentryRef[]>([]);
  const [sentrySearch, setSentrySearch] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Filed, with things the tester should know (files or links Jira refused): shown here, not in a browser alert.
  const [filed, setFiled] = useState<{ key: string; notes: string[] } | null>(null);
  const [pending, start] = useTransition();
  const [searching, startSearch] = useTransition();
  // Bug templates: the team's list, which one is picked, and the bug being filled in with it.
  const [choices, setChoices] = useState<{ current: CurrentLayout; templates: TemplateChoice[] } | null>(null);
  const [chosen, setChosen] = useState("");
  const [draft, setDraft] = useState<TemplatedDraft | null>(null);
  const [loadingTemplate, startTemplate] = useTransition();
  // Found-in version: the Jira version picked for you, and what the person picked.
  const [foundDraft, setFoundDraft] = useState<FoundInDraft | null>(null);
  const [foundIn, setFoundIn] = useState("");
  // Where a file made in the box came from, as the chips say it: "Step 3", "Whole case".
  const here = stepLabel.charAt(0).toUpperCase() + stepLabel.slice(1);
  const files = [...attachments, ...added.filter((a) => !attachments.some((b) => b.id === a.id))];
  const candidates = others.filter((o) => !files.some((f) => f.id === o.id));
  // Screenshots and videos ticked for the bug, for a template that needs one.
  const shots = files.filter((f) => include.has(f.id) && /^(image|video)\//.test(f.contentType)).length;
  const pick = (picked: Attached[]) => {
    setAdded((x) => [...x, ...picked]);
    setInclude((s) => new Set([...s, ...picked.map((p) => p.id)]));
  };
  // Take screenshot / Record screen right in the box: the new file goes on the step too.
  const support = useCaptureSupport();
  const recorder = useScreenRecorder(
    (f) => void upload([f.file]),
    (message) => setError(message),
  );
  const [shooting, setShooting] = useState(false);
  const capture: BugCapture = {
    ok: support.ok,
    why: support.why,
    busy: shooting || uploading || recorder.rec !== null,
    screenshot: async () => {
      setShooting(true);
      try {
        const file = await takeScreenshot(`${captureName} screenshot.png`);
        if (file) await upload([file]);
      } catch {
        setError("Couldn't take the screenshot.");
      } finally {
        setShooting(false);
      }
    },
    record: () => void recorder.start({ stepIndex, label: `for this bug`, baseName: captureName }),
    ...(sentryOn && jiraConnected ? { sentry: () => setSentrySearch(true) } : {}),
  };
  // Closing the box mid-recording throws the recording away.
  const stopRecording = recorder.stop;
  useEffect(() => {
    if (!open) stopRecording(false);
  }, [open, stopRecording]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFiled(null);
    setTab("new");
    setInclude(new Set(attachments.map((a) => a.id)));
    setReporter(null);
    setTemplate(null);
    setImported(null);
    setAdded([]);
    setSentryList(sentryErrors);
    setSentrySearch(false);
    setLinkTo(new Set(linkStories ? stories.map((x) => x.key) : []));
    setNotThis([]);
    setDraft(null);
    setChosen("");
    setFoundDraft(null);
    if (jiraConnected)
      void previewFoundIn(projectId, entryId).then((res) => {
        if (!res.ok || !res.foundIn) return;
        setFoundDraft(res.foundIn);
        setFoundIn(res.foundIn.value);
      });
    void bugTemplateChoices(projectId).then((res) => {
      if (!res.ok) return;
      setChoices(res.templates.length ? { current: res.current, templates: res.templates } : null);
      if (res.defaultId) pickTemplate(res.defaultId, res.templates, null);
    });
    if (!jiraConnected) {
      setSummary(prefill?.title ?? suggested ?? (stepIndex === null ? "" : `${stepLabel} failed`));
      if (prefill) setSeverity(prefill.severity);
      setHappened("");
      void previewLocalBug(projectId, entryId, stepIndex, actual, focus).then((res) => res.ok && setHappened((n) => n || res.body));
      return;
    }
    start(async () => {
      const res = await previewJiraBug(projectId, entryId, stepIndex, actual, focus);
      if (res.ok) {
        setSummary(fromDefect?.title ?? prefill?.title ?? res.summary);
        setScale(res.scale);
        setJiraPriority(res.priority);
        setSeverity(fromDefect?.severity ?? prefill?.severity ?? defaultSeverityOf(res.scale));
        setBody(res.body);
        setReporter(res.reporter);
        if (res.template) {
          const { bug, web } = res.template;
          const context = bug.history.context || (web ? browserContext(navigator.userAgent) : "");
          setTemplate({ ...bug, brief: bug.brief || prefill?.title || "", history: { ...bug.history, dateTime: stamp(), context } });
          setOptions(res.template.options);
        }
        if (res.imported) setImported({ ...res.imported, summary: prefill?.title ?? "" });
        setSevPicked(!res.imported || !!prefill);
      } else setError(res.error);
    });
    // Only when the dialog opens for a step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open || tab !== "link" || !jiraConnected) return;
    const t = setTimeout(
      () =>
        startSearch(async () => {
          const res = await searchJira(projectId, q);
          if (res.ok) {
            setResults(res.issues);
            setError(null);
          } else setError(res.error);
        }),
      q ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [q, tab, open, jiraConnected, projectId]);

  /** Switch template: what was typed under a heading with the same name comes along. */
  const pickTemplate = (id: string, list = choices?.templates ?? [], before: TemplatedDraft | null = draft) => {
    setChosen(id);
    if (!id) return setDraft(null);
    const t = list.find((x) => x.id === id);
    if (!t) return;
    startTemplate(async () => {
      const res = await startTemplatedBug(projectId, entryId, stepIndex, actual, id);
      if (!res.ok) return setError(res.error);
      const auto = { ...res.auto, now: nowCell(), device: deviceCell(navigator.userAgent) };
      const typed = new Map((before?.answers ?? []).filter((a) => a.text.trim()).map((a) => [a.heading.trim().toLowerCase(), a] as const));
      const answers: Answer[] = startAnswers(t.layout, res.fill, auto).map((a) => {
        const old = typed.get(a.heading.trim().toLowerCase());
        return old && !a.rows && (a.source === old.source || a.source === "text" || a.source === "actual") ? { ...a, text: old.text } : a;
      });
      setDraft({
        templateId: id,
        layout: t.layout,
        platform: before?.platform ?? res.platform,
        area: before?.area ?? res.area,
        build: before?.build ?? res.build,
        summary: before?.summary || fromDefect?.title || prefill?.title || res.summary,
        answers,
        fields: res.fields,
      });
    });
  };

  // Hidden when the bug's own layout already has that Jira field (a copied layout's version field).
  const layoutFields = chosen ? (draft?.fields ?? []) : imported ? imported.fields : [];
  const foundShown = !!foundDraft && jiraConnected && !layoutFields.some((f) => f.id === foundDraft.field);
  const foundBox = foundShown && foundDraft ? <FoundInLine key={`${entryId}-${stepIndex}`} draft={foundDraft} value={foundIn} onChange={setFoundIn} /> : null;

  const done = (d: LinkedDefect) => {
    onLinked(d);
    onClose();
  };

  const create = () =>
    start(async () => {
      setError(null);
      if (draft) {
        const ordered = [...orderFiles(files).media, ...orderFiles(files).logs].filter((a) => include.has(a.id)).map((a) => a.id);
        const res = await fileTemplatedBug(projectId, entryId, {
          templateId: draft.templateId,
          summary: draft.summary,
          platform: draft.platform,
          area: draft.area,
          build: draft.build,
          severity,
          stepIndex,
          actual,
          answers: draft.answers,
          attachmentIds: ordered,
          fields: Object.fromEntries(draft.fields.map((f) => [f.id, f.value])),
          stories: [...linkTo],
          regression: !!regression && markReg,
          sentry: sentryList,
          ...(fromDefect && { fromDefectId: fromDefect.id }),
          ...(foundShown && { foundIn }),
        });
        if (!res.ok) return setError(res.error);
        const notes = [res.attachError && `${res.defect.externalKey} was created, but attaching files failed: ${res.attachError}`, res.reporterNote, res.linkError].filter((n): n is string => !!n);
        if (!notes.length) return done(res.defect);
        onLinked(res.defect);
        setFiled({ key: res.defect.externalKey ?? `#${res.defect.number}`, notes });
        return;
      }
      if (!jiraConnected) {
        const res = await createLocalDefect(projectId, { title: summary, severity, description: happened, entryId });
        return res.ok ? done(res.defect) : setError(res.error);
      }
      // Screenshots and videos first, then logs, as they appear on the bug.
      const ordered = [...orderFiles(files).media, ...orderFiles(files).logs].filter((a) => include.has(a.id)).map((a) => a.id);
      const res = await fileJiraBug(projectId, entryId, {
        summary,
        severity,
        stepIndex,
        focus,
        actual,
        attachmentIds: ordered,
        stories: [...linkTo],
        regression: !!regression && markReg,
        sentry: sentryList,
        ...(fromDefect && { fromDefectId: fromDefect.id }),
        ...(foundShown && { foundIn }),
        ...(template && { template }),
        ...(imported && {
          imported: {
            tag: imported.tag,
            feature: imported.feature,
            summary: imported.summary,
            sections: imported.sections.map((x) => ({ heading: x.heading, text: x.text })),
            fields: Object.fromEntries(imported.fields.map((f) => [f.id, f.value])),
          },
        }),
      });
      if (!res.ok) return setError(res.error);
      const notes = [
        res.attachError && `${res.defect.externalKey} was created, but attaching files failed: ${res.attachError}`,
        res.reporterNote,
        res.linkError,
      ].filter((n): n is string => !!n);
      if (!notes.length) return done(res.defect);
      onLinked(res.defect);
      setFiled({ key: res.defect.externalKey ?? `#${res.defect.number}`, notes });
    });

  const upload = async (list: File[]) => {
    setUploading(true);
    for (const file of list) {
      const form = new FormData();
      form.set("file", file);
      if (stepIndex !== null) form.set("stepIndex", String(stepIndex));
      const res = await uploadAttachment(projectId, form);
      if (!res.ok) {
        setError(res.error);
        continue;
      }
      const a = { id: res.attachment.id, fileName: res.attachment.fileName, contentType: res.attachment.contentType, label: here };
      setAdded((x) => [...x, a]);
      setInclude((s) => new Set(s).add(a.id));
      onUploaded?.(a);
    }
    setUploading(false);
  };

  const link = (key: string) =>
    start(async () => {
      setError(null);
      const res = await linkJiraIssue(projectId, key);
      return res.ok ? done(res.defect) : setError(res.error);
    });

  return (
    <Modal open={open} onClose={onClose} title={fromDefect ? `Send ${fromDefect.label} to Jira` : `Report a bug · ${stepLabel}`} wide>
      {filed ? (
        <div className="space-y-3" data-testid="bug-filed-notes">
          <p className="text-sm font-medium text-slate-800">Filed {filed.key} in Jira.</p>
          {filed.notes.map((n) => (
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
        <>
          <div className="mb-4 flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
            {(fromDefect ? (["new"] as const) : (["new", "link"] as const)).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx("flex-1 rounded px-3 py-1.5", tab === t ? "bg-surface font-medium text-slate-900 shadow-sm" : "text-slate-600")}
              >
                {t === "new" ? (fromDefect ? "New Jira bug" : "New bug") : "Link existing bug"}
              </button>
            ))}
          </div>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>

          {tab === "new" ? (
            <>
            {!fromDefect && known.filter((b) => !notThis.includes(b.id)).length > 0 && (
              <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm" data-testid="known-in-dialog">
                <p className="font-semibold text-amber-950">This step already has a known bug</p>
                {known
                  .filter((b) => !notThis.includes(b.id))
                  .map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="font-mono text-xs font-semibold">{b.key}</span> <span className="text-slate-900">{b.title}</span>{" "}
                        <span className="text-xs text-slate-600">({b.status})</span>
                      </span>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          onKnownStill?.(b);
                          onClose();
                        }}
                      >
                        It&apos;s this one: Still happens
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setNotThis((n) => [...n, b.id]);
                          if (b.externalKey && jiraConnected) setLinkTo((s) => new Set([...s, b.externalKey!]));
                        }}
                      >
                        No, it&apos;s a different bug
                      </Button>
                    </div>
                  ))}
                <p className="text-xs text-amber-900">Marking it Still happens saves a second copy of the same bug.</p>
              </div>
            )}
            {notThis.some((id) => known.find((b) => b.id === id)?.externalKey) && jiraConnected && (
              <p className="mt-2 text-xs text-slate-500">
                The new bug will link to {known.filter((b) => notThis.includes(b.id) && b.externalKey).map((b) => b.key).join(", ")} as related.
              </p>
            )}
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              {choices && <TemplatePicker current={choices.current} templates={choices.templates} value={chosen} onChange={(id) => pickTemplate(id)} />}
              {chosen ? (
                draft && draft.templateId === chosen ? (
                  <>
                    {reporter && jiraConnected && <ReporterLine reporter={reporter} />}
                    <TemplatedForm projectId={projectId} draft={draft} setDraft={(fn) => setDraft((d) => (d ? fn(d) : d))} severity={severity} setSeverity={setSeverity} scale={scale} setError={setError} />
                    <PriorityLine priority={jiraConnected ? jiraPriority : null} />
                    {foundBox}
                    <BugFiles files={files} include={include} setInclude={setInclude} candidates={candidates} onPick={pick} onUpload={upload} capture={capture} uploading={uploading} />
                  </>
                ) : (
                  <p className="text-sm text-slate-500" role="status">
                    {loadingTemplate ? "Opening the template…" : "Pick a template."}
                  </p>
                )
              ) : template ? (
                <>
                  {reporter && <ReporterLine reporter={reporter} />}
                  <BugTemplateForm
                    bug={template}
                    setBug={(fn) => setTemplate((b) => (b ? fn(b) : b))}
                    options={options}
                    severity={severity}
                    setSeverity={setSeverity}
                    scale={scale}
                    priority={jiraPriority}
                    files={files}
                    include={include}
                    setInclude={setInclude}
                    onAdd={upload}
                    uploading={uploading}
                    candidates={candidates}
                    onPick={pick}
                    capture={capture}
                  />
                  {foundBox}
                </>
              ) : imported ? (
                <>
                  {reporter && <ReporterLine reporter={reporter} />}
                  <ImportedForm
                    bug={imported}
                    setBug={(fn) => setImported((b) => (b ? fn(b) : b))}
                    severity={sevPicked ? severity : ""}
                    scale={scale}
                    setSeverity={(x) => {
                      setSeverity(x);
                      setSevPicked(true);
                    }}
                  />
                  <PriorityLine priority={jiraConnected ? jiraPriority : null} />
                  {foundBox}
                  <BugFiles
                    files={files}
                    include={include}
                    setInclude={setInclude}
                    candidates={candidates}
                    onPick={pick}
                    onUpload={upload}
                    capture={capture}
                    uploading={uploading}
                  />
                </>
              ) : (
                <>
                  <Field label="Summary" htmlFor="bug-summary" hint={focus !== null && stepIndex === null ? "Filled from the failed step. Change it to say what's wrong." : undefined}>
                    <Input id="bug-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What went wrong? For example: Pay button does nothing" required autoFocus />
                  </Field>
                  {!jiraConnected && (
                    <Field label="What happened" htmlFor="bug-notes">
                      <Textarea id="bug-notes" rows={6} value={happened} onChange={(e) => setHappened(e.target.value)} placeholder="Steps to make it happen, what you expected, and what happened instead" />
                    </Field>
                  )}
                  <Field label="Severity" htmlFor="bug-severity">
                    <Select id="bug-severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="w-auto min-w-48 max-w-full">
                      {scale.levels.map((s) => (
                        <option key={s} value={s}>
                          {scale.labels[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <PriorityLine priority={jiraConnected ? jiraPriority : null} />
                  {foundBox}
                  {jiraConnected ? (
                    <>
                      {reporter && <ReporterLine reporter={reporter} />}
                      <div>
                        <p className="mb-1 text-xs font-medium text-slate-600">Description (filled in for you)</p>
                        <pre className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs whitespace-pre-wrap wrap-anywhere text-slate-700">
                          {body || "Loading…"}
                        </pre>
                      </div>
                      <BugFiles
                        files={files}
                        include={include}
                        setInclude={setInclude}
                        candidates={candidates}
                        onPick={pick}
                        onUpload={upload}
                        capture={capture}
                        uploading={uploading}
                      />
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">Jira isn&apos;t connected, so this is recorded here only. An admin can connect Jira in Settings.</p>
                  )}
                </>
              )}
              {(jiraConnected || sentryList.length > 0) && <SentryBugSection jira={jiraConnected} projectId={projectId} entryId={entryId} list={sentryList} setList={setSentryList} searching={sentrySearch} setSearching={setSentrySearch} />}
              {jiraConnected && stories.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className="sr-only">Link to requirements</legend>
                  {stories.map((st) => (
                    <label key={st.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={linkTo.has(st.key)}
                        onChange={(e) =>
                          setLinkTo((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(st.key);
                            else n.delete(st.key);
                            return n;
                          })
                        }
                      />
                      Link to requirement <span className="font-mono">{st.key}</span> in Jira
                      <InfoTip text={`Adds a "relates to" link from the new bug to ${st.key}${st.title ? ` (${st.title})` : ""}, so the requirement shows it.`} />
                    </label>
                  ))}
                </fieldset>
              )}
              {jiraConnected && regression && (
                <label className="flex items-start gap-1.5 rounded-md bg-pink-50 px-2.5 py-2 text-sm text-pink-900 ring-1 ring-pink-200 ring-inset">
                  <input type="checkbox" className="mt-1" checked={markReg} onChange={(e) => setMarkReg(e.target.checked)} />
                  <span>
                    Mark as a regression in Jira
                    <span className="block text-xs text-pink-800">
                      Adds the label <span className="font-mono">{regression.label}</span> and a line saying it passed in {regression.against} and which builds to compare.
                    </span>
                  </span>
                </label>
              )}
              <RecordingBar r={recorder} inline />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {chosen && draft && missingLine(draft, shots) && (
                  <span className="text-xs text-amber-800" data-testid="template-missing">
                    {missingLine(draft, shots)}
                  </span>
                )}
                <Button onClick={onClose}>Cancel</Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    pending ||
                    uploading ||
                    recorder.rec !== null ||
                    (chosen
                      ? !draft || draft.templateId !== chosen || !!missingLine(draft, shots)
                      : template
                      ? !template.brief.trim() || !template.reproSteps.trim()
                      : imported
                        ? !imported.summary.trim() || !sevPicked || imported.fields.some((f) => f.required && !f.value.some((v) => v.trim()))
                        : !summary.trim())
                  }
                >
                  {pending ? "Creating…" : jiraConnected ? "File bug in Jira" : "Save bug"}
                </Button>
              </div>
            </form>
            </>
          ) : (
            <div className="mt-3 space-y-3">
              {recent.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-600">Already found in this run</p>
                  <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                    {recent.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="font-mono text-xs text-slate-500">{d.externalKey ?? `D-${d.number}`}</span>
                        <span className="min-w-0 flex-1 truncate">{d.title}</span>
                        <Button size="sm" onClick={() => done(d)}>
                          Link
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {jiraConnected ? (
                <>
                  <Input autoFocus placeholder="Search Jira, or paste an issue key or link (QA-123)" value={q} onChange={(e) => setQ(e.target.value)} />
                  <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
                    {(results ?? []).map((i) => (
                      <li key={i.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <a href={i.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent-700 hover:underline">
                          {i.key}
                        </a>
                        <span className="min-w-0 flex-1 truncate">{i.summary}</span>
                        <span className="text-xs text-slate-500">{i.status}</span>
                        <Button size="sm" disabled={pending} onClick={() => link(i.key)}>
                          Link
                        </Button>
                      </li>
                    ))}
                    {results && results.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No matching bugs.</li>}
                    {searching && !results && <li className="px-3 py-4 text-center text-sm text-slate-500">Searching…</li>}
                  </ul>
                </>
              ) : (
                recent.length === 0 && <p className="text-sm text-slate-500">No bugs found in this run yet. Connect Jira in Settings to link Jira bugs.</p>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * Who Jira will show as the bug's Reporter: one quiet line. When your Jira
 * account isn't found, the connected account files it and your name goes in the description.
 */
function ReporterLine({ reporter }: { reporter: ReporterInfo }) {
  if (reporter.found)
    return (
      <p className="text-xs text-slate-500" data-testid="jira-reporter" title={`Found by your email, ${reporter.email}`}>
        Reporter in Jira: <span className="font-medium text-slate-700">{reporter.name}</span> (you)
      </p>
    );
  return (
    <p className="text-xs text-slate-500" data-testid="jira-reporter">
      Reporter in Jira: <span className="font-medium text-slate-700">{reporter.owner}</span> (your name goes in the description) ·{" "}
      <a
        href="/account#jira"
        target="_blank"
        rel="noreferrer"
        className="text-accent-700 hover:underline"
        title={`No Jira user has the email ${reporter.email}`}
      >
        Set your Jira email
      </a>
    </p>
  );
}

/**
 * Values Jira won't take in a picker field, like a version Jira doesn't have yet:
 * said in words, since they go in the description instead.
 */
function NotInJira({ field: f, onRemove }: { field: ImportedBug["fields"][number]; onRemove: (v: string) => void }) {
  const missing = f.pick ? f.value.filter((v) => v.trim() && !f.options.includes(v)) : [];
  if (!missing.length) return null;
  const what = f.source === "release" ? "version" : "choice";
  return (
    <p className="mt-1 text-xs text-amber-800" data-testid="not-in-jira">
      {missing.map((v) => `"${v}"`).join(", ")} {missing.length === 1 ? "isn't a" : "aren't"} {what}
      {missing.length === 1 ? "" : "s"} in Jira{f.options.length ? "" : " yet"}, so {missing.length === 1 ? "it goes" : "they go"} in the description instead.{" "}
      {missing.map((v) => (
        <button key={v} type="button" className="text-accent-700 hover:underline" onClick={() => onRemove(v)}>
          Leave {missing.length === 1 ? "it" : `"${v}"`} out
        </button>
      ))}
    </p>
  );
}

/** A bug in the team's imported template: the title in its shape, its description sections and its Jira fields. */
function ImportedForm({
  bug,
  setBug,
  severity,
  scale,
  setSeverity,
}: {
  bug: ImportedBug;
  setBug: (fn: (b: ImportedBug) => ImportedBug) => void;
  severity: Severity | "";
  scale: SeverityScale;
  setSeverity: (s: Severity) => void;
}) {
  const setField = (id: string, value: string[]) => setBug((b) => ({ ...b, fields: b.fields.map((f) => (f.id === id ? { ...f, value } : f)) }));
  return (
    <div className="space-y-4" data-testid="imported-template">
      <div className="space-y-2">
        <div className="grid gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
          {bug.title.tag && (
            <Field label="Tag" htmlFor="it-tag">
              <Input id="it-tag" value={bug.tag} onChange={(e) => setBug((b) => ({ ...b, tag: e.target.value.toUpperCase() }))} placeholder="Optional" />
            </Field>
          )}
          {bug.title.feature && (
            <Field label="Feature" htmlFor="it-feature">
              <Input id="it-feature" value={bug.feature} onChange={(e) => setBug((b) => ({ ...b, feature: e.target.value }))} placeholder="Optional" />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Summary" htmlFor="it-summary">
              <Input
                id="it-summary"
                value={bug.summary}
                onChange={(e) => setBug((b) => ({ ...b, summary: e.target.value }))}
                required
                autoFocus
                placeholder="What's wrong, in a few words"
              />
            </Field>
          </div>
        </div>
        {(bug.title.tag || bug.title.feature) && (
          <p className="text-[13px] text-slate-600">
            Jira title:{" "}
            <span className="font-semibold text-slate-900" data-testid="imported-title">
              {importedTitle(bug.title, bug)}
            </span>
          </p>
        )}
      </div>
      <Field label="Severity" htmlFor="it-severity">
        <Select id="it-severity" value={severity} onChange={(e) => e.target.value && setSeverity(e.target.value as Severity)} className="w-auto min-w-48 max-w-full">
          {!severity && <option value="">Choose…</option>}
          {scale.levels.map((x) => (
            <option key={x} value={x}>
              {scale.labels[x]}
            </option>
          ))}
        </Select>
      </Field>
      {bug.sections.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-bold tracking-wider text-slate-700">DESCRIPTION</p>
          {bug.sections.map((x, i) => (
            <Field key={x.heading} label={x.heading} htmlFor={`it-s${i}`}>
              <Textarea
                id={`it-s${i}`}
                rows={x.source === "steps" ? 5 : 3}
                value={x.text}
                onChange={(e) => setBug((b) => ({ ...b, sections: b.sections.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) }))}
              />
            </Field>
          ))}
        </div>
      )}
      {bug.fields.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-bold tracking-wider text-slate-700">JIRA FIELDS</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {bug.fields.map((f) => (
              <Field key={f.id} label={`${f.name}${f.required ? " (required)" : ""}`} htmlFor={`it-f-${f.id}`}>
                {f.options.length && f.multi ? (
                  <div role="group" aria-label={f.name} className="flex flex-wrap gap-1.5">
                    {f.options.map((o) => {
                      const on = f.value.includes(o);
                      return (
                        <button
                          key={o}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setField(f.id, on ? f.value.filter((v) => v !== o) : [...f.value, o])}
                          className={cx(
                            "rounded-full border px-2.5 py-0.5 text-[13px]",
                            on ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400",
                          )}
                        >
                          {o}
                        </button>
                      );
                    })}
                  </div>
                ) : f.options.length ? (
                  <Select id={`it-f-${f.id}`} value={f.value[0] ?? ""} onChange={(e) => setField(f.id, [e.target.value].filter(Boolean))}>
                    <option value="">Choose…</option>
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </Select>
                ) : f.long ? (
                  <Textarea id={`it-f-${f.id}`} rows={3} value={f.value.join("\n")} onChange={(e) => setField(f.id, [e.target.value])} />
                ) : (
                  <Input
                    id={`it-f-${f.id}`}
                    value={f.value.join(", ")}
                    onChange={(e) => setField(f.id, f.multi ? e.target.value.split(/\s*,\s*/) : [e.target.value])}
                  />
                )}
                <NotInJira
                  field={f}
                  onRemove={(v) =>
                    setField(
                      f.id,
                      f.value.filter((x) => x !== v),
                    )
                  }
                />
              </Field>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

// Bug bash bugs ready for Jira (ver_220): the OKO form at wrap-up, Ready for Jira / Needs N,
// what Flaw Patrol filled in, Not a bug with a reason, and Can't reproduce's note to the finder.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Severity } from "@prisma/client";
import { answerBashAsk, askBashFinder, bashOkoOptions, fillBashOko } from "@/server/bashes";
import { uploadAttachment } from "@/server/results";
import { askFinderNote, CANT_REPRODUCE, firstName, isAskOf, NOT_A_BUG_REASONS, okoFilled } from "@/lib/bash-oko";
import { optionLike, type TemplateBug } from "@/lib/bug-template";
import { draftToOko } from "@/lib/oko-draft";
import type { BashView } from "@/lib/bash-summary";
import type { SeverityScale } from "@/lib/severity";
import { BugTemplateForm, type TemplateOptions } from "./bug-template-form";
import type { BugCapture, BugFile } from "./bug-files";
import { RecordingBar, takeScreenshot, useCaptureSupport, useScreenRecorder } from "./screen-capture";
import { Button, cx, Input, Textarea } from "./ui";

type Item = BashView["items"][number];
type Tpl = NonNullable<Item["template"]>;

/** "✓ Ready for Jira" or "Needs 2: Bug impact, Workaround": words, never color alone. */
export function ReadyLine({ t, jira }: { t: Tpl; jira: boolean }) {
  return t.needs.length ? (
    <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900" data-testid="needs-tag">
      Needs {t.needs.length}: <span className="font-normal">{t.needs.join(", ")}</span>
    </span>
  ) : (
    <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-800" data-testid="needs-tag">
      ✓ Ready {jira ? "for Jira" : "to file"}
    </span>
  );
}

/** "Filled in for you: Team Web · Client/SKUs Web · Build # 4.21.0 · OKO Space Link N/a" */
export function FilledLine({ t, platform }: { t: Tpl; platform: string }) {
  const filled = okoFilled(t.layout, t.answers, platform);
  if (!filled.length) return null;
  return (
    <span className="mt-1 block text-xs text-slate-600" data-testid="oko-filled">
      Filled in for you:{" "}
      {filled.map((f, i) => (
        <span key={f.name}>
          {i > 0 && " · "}
          {f.name} <b className="font-semibold text-slate-800">{f.value}</b>
        </span>
      ))}
    </span>
  );
}

const BASH_LEVELS: Severity[] = ["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR"];

/**
 * Fill in at wrap-up with the OKO form: the very same form as a run's Report a bug and Write a bug
 * (Scott: "the OKO template should be the same wherever it appears"). Save, or Save and next.
 */
export function OkoFill({ bash, b, next, onDone, setError }: { bash: BashView; b: Item & { template: Tpl }; next: Item | null; onDone: (goNext: boolean) => void; setError: (e: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const area = bash.areas.find((a) => a.id === b.areaId)?.name ?? "";
  const [options, setOptions] = useState<TemplateOptions>({ clients: [], team: [], olyEnv: [] });
  const [bug, setBug] = useState<TemplateBug>(() => draftToOko({ platform: b.platform, area, summary: b.text, answers: b.template.answers, fields: b.template.layout.fields }));
  const [severity, setSeverity] = useState<Severity>(b.severity);
  const [added, setAdded] = useState<BugFile[]>([]);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    void bashOkoOptions(bash.id).then((r) => {
      if (!r.ok) return;
      setOptions(r.options);
      // Client/SKUs nobody picked follows the bug's client, as filing does.
      setBug((x) => (x.clients.length || !b.platform ? x : { ...x, clients: [optionLike(r.options.clients, b.platform) || b.platform] }));
    });
  }, [bash.id, b.platform]);
  const upload = async (list: File[]) => {
    setUploading(true);
    for (const f of list) {
      const form = new FormData();
      form.set("file", f);
      form.set("bashId", bash.id);
      const r = await uploadAttachment(bash.runProjectId, form);
      if (r.ok) setAdded((a) => [...a, { id: r.attachment.id, fileName: r.attachment.fileName, contentType: r.attachment.contentType, size: r.attachment.size, label: "Added here" }]);
      else setError(r.error);
    }
    setUploading(false);
  };
  // Take screenshot / Record screen, as in every other OKO form.
  const support = useCaptureSupport();
  const recorder = useScreenRecorder(
    (f) => void upload([f.file]),
    (message) => setError(message),
  );
  const [shooting, setShooting] = useState(false);
  const capture: BugCapture = {
    ok: support.ok,
    why: support.why,
    busy: shooting || uploading || recorder.rec !== null || recorder.picking,
    area: support.area,
    screenshot: () => {
      setShooting(true);
      void takeScreenshot("Bug screenshot.png")
        .then((f) => (f ? upload([f]) : undefined))
        .catch(() => setError("Couldn't take the screenshot."))
        .finally(() => setShooting(false));
    },
    record: () => void recorder.start({ stepIndex: null, label: "for this bug", baseName: "Bug" }),
    recordArea: () => void recorder.start({ stepIndex: null, label: "for this bug", baseName: "Bug", area: true }),
  };
  const stopRecording = recorder.stop;
  useEffect(() => () => stopRecording(false), [stopRecording]);
  const files: BugFile[] = [...b.attachments.map((a) => ({ ...a, label: "From the bash" })), ...added];
  const [include, setInclude] = useState<Set<string>>(new Set());
  const on = new Set([...b.attachments.map((a) => a.id), ...added.filter((f) => !include.has(f.id)).map((f) => f.id)]);
  const scale: SeverityScale = { labels: bash.sevNames, levels: BASH_LEVELS, critical: ["SHOWSTOPPER", "CRITICAL"], fromJira: false };
  const save = (goNext: boolean) =>
    start(async () => {
      setError(null);
      const r = await fillBashOko(b.id, { bug, severity, attachmentIds: added.filter((f) => on.has(f.id)).map((f) => f.id) });
      if (!r.ok) return setError(r.error);
      router.refresh();
      onDone(goNext);
    });
  return (
    <div className="max-w-3xl space-y-3" data-testid="bash-oko-fill">
      <RecordingBar r={recorder} inline />
      <p className="text-sm font-semibold text-slate-800">
        {b.template.needs.length ? "Fill in" : "Edit"}: {b.text} <span className="font-normal text-slate-500">· {b.template.name}</span>
      </p>
      {b.template.needs.length > 0 && <p className="text-xs text-amber-900">Jira still needs: {b.template.needs.join(", ")}</p>}
      <BugTemplateForm
        bug={bug}
        setBug={(fn) => setBug(fn)}
        options={options}
        severity={severity}
        setSeverity={(s) => setSeverity(BASH_LEVELS.includes(s) ? s : "PROBLEMATIC")}
        scale={scale}
        files={files}
        include={on}
        setInclude={(fn) => {
          // Files from the bash stay on the bug; files added here can be unticked.
          const kept = fn(on);
          setInclude(new Set(added.map((f) => f.id).filter((id) => !kept.has(id))));
        }}
        onAdd={(list) => void upload(list)}
        uploading={uploading}
        capture={capture}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={() => onDone(false)}>
          Cancel
        </Button>
        {next && (
          <Button size="sm" disabled={pending} onClick={() => save(true)} data-testid="oko-save-next">
            Save and fill in the next one
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={pending} onClick={() => save(false)}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/**
 * File it / Not a bug, as one radio group (screen readers hear the choice), and Not a bug's
 * reasons. Can't reproduce offers a note to the finder.
 */
export function FileOrNot({ b, disabled, onChoose }: { b: Item & { review: string; reviewReason: string }; disabled: boolean; onChoose: (data: { review: "file" | "skip"; reason?: string }) => void }) {
  const not = b.review === "skip";
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const other = not && b.reviewReason && !(NOT_A_BUG_REASONS as readonly string[]).includes(b.reviewReason);
  const radio = (on: boolean) => cx("inline-flex min-h-8 items-center rounded-md px-2.5 text-xs font-semibold ring-1 ring-inset", on ? "bg-accent-600 text-white ring-accent-600" : "bg-surface text-slate-700 ring-slate-300 hover:bg-slate-50");
  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label={`File or not: ${b.text}`} className="inline-flex gap-1" data-howto="wrap-file-it">
        <button type="button" role="radio" aria-checked={!not} disabled={disabled} className={radio(!not)} onClick={() => onChoose({ review: "file" })}>
          File it
        </button>
        <button type="button" role="radio" aria-checked={not} disabled={disabled} className={radio(not)} onClick={() => onChoose({ review: "skip", reason: b.reviewReason })} data-howto="wrap-not-a-bug">
          Not a bug
        </button>
      </div>
      {not && (
        <div role="group" aria-label={`Why it's not a bug: ${b.text}`} className="flex flex-wrap items-center gap-1" data-testid="not-a-bug-reasons">
          {NOT_A_BUG_REASONS.map((r) => (
            <button key={r} type="button" aria-pressed={b.reviewReason === r} disabled={disabled} onClick={() => onChoose({ review: "skip", reason: b.reviewReason === r ? "" : r })} className={cx("inline-flex min-h-6 items-center rounded-full px-2 text-[11px] ring-1 ring-inset", b.reviewReason === r ? "bg-slate-800 font-semibold text-slate-50 ring-slate-800" : "text-slate-700 ring-slate-300 hover:bg-slate-50")}>
              {r}
            </button>
          ))}
          {typing ? (
            <Input
              autoFocus
              aria-label={`Other reason: ${b.text}`}
              value={typed}
              maxLength={120}
              placeholder="Why?"
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => {
                setTyping(false);
                if (typed.trim()) onChoose({ review: "skip", reason: typed.trim() });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setTyping(false);
              }}
              className="h-7 w-36 text-xs"
            />
          ) : (
            <button type="button" aria-pressed={!!other} disabled={disabled} onClick={() => { setTyped(other ? b.reviewReason : ""); setTyping(true); }} className={cx("inline-flex min-h-6 items-center rounded-full px-2 text-[11px] ring-1 ring-inset", other ? "bg-slate-800 font-semibold text-slate-50 ring-slate-800" : "text-slate-700 ring-slate-300 hover:bg-slate-50")}>
              {other ? b.reviewReason : "Other…"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Can't reproduce: a note that @mentions the finder, sent once. Shows what was sent and any answer. */
export function AskFinder({ b, meId, setError }: { b: Item; meId: string; setError: (e: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(() => askFinderNote(b.byName));
  const [said, setSaid] = useState<string | null>(null);
  const ask = b.adds.find((a) => isAskOf(a.text, b.byName));
  const answers = ask ? b.adds.filter((a) => a.byId === b.byId && a.at > ask.at) : [];
  const first = firstName(b.byName) || "the finder";
  if (b.byId === meId) return null;
  if (ask)
    return (
      <div className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700" data-testid="bash-ask-sent">
        <p>
          Sent to {first}: &ldquo;{ask.text}&rdquo;
        </p>
        {answers.length ? (
          <p className="mt-1 text-slate-800">
            <b className="font-semibold">{first} added:</b> {answers.map((a) => a.text).join(" · ")}. Switch to <b>File it</b> to send it.
          </p>
        ) : (
          <p className="mt-0.5 text-slate-500">{said ?? `${first} sees it when they open this bash.`}</p>
        )}
      </div>
    );
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md bg-slate-50 p-2" data-testid="bash-ask">
      <label htmlFor={`ask-${b.id}`} className="block text-xs font-semibold text-slate-700">
        Ask {first} for steps
      </label>
      <Textarea id={`ask-${b.id}`} rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className="text-xs" />
      <Button
        size="sm"
        disabled={pending || !note.trim()}
        data-howto="wrap-ask-finder"
        onClick={() =>
          start(async () => {
            const r = await askBashFinder(b.id, note);
            if (!r.ok) return setError(r.error);
            setSaid(r.emailed ? `Emailed to ${first} too.` : null);
            router.refresh();
          })
        }
      >
        Send to {first}
      </Button>
    </div>
  );
}

/** The finder's side: wrap-up asked them for steps. They answer here; it goes on the bug. */
export function AskedOfYou({ bash }: { bash: BashView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const asked = bash.items
    .filter((i) => i.kind === "bug" && i.byId === bash.me.id)
    .map((i) => ({ i, ask: i.adds.find((a) => isAskOf(a.text, i.byName)) }))
    .filter((x): x is { i: Item; ask: Item["adds"][number] } => !!x.ask);
  if (!asked.length) return null;
  return (
    <div className="mt-4 space-y-3 first:mt-0" data-testid="bash-asked-of-you">
      <p className="font-semibold text-slate-900">{asked.length === 1 ? "One of your bugs needs" : `${asked.length} of your bugs need`} steps</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {asked.map(({ i, ask }) => {
        const mine = i.adds.filter((a) => a.byId === bash.me.id && a.at > ask.at);
        return (
          <div key={i.id} className="rounded-md bg-amber-50 p-3 ring-1 ring-amber-200 ring-inset">
            <p className="text-sm font-medium text-slate-900">{i.text}</p>
            <p className="text-xs text-amber-900">
              {ask.byName}: {ask.text}
            </p>
            {mine.length > 0 && <p className="mt-1 text-xs text-slate-700">You added: {mine.map((a) => a.text).join(" · ")}</p>}
            <label htmlFor={`answer-${i.id}`} className="mt-2 block text-xs font-semibold text-slate-700">
              Steps to see it
            </label>
            <Textarea id={`answer-${i.id}`} rows={3} value={typed[i.id] ?? ""} onChange={(e) => setTyped((t) => ({ ...t, [i.id]: e.target.value }))} placeholder={"1. …\n2. …"} className="text-sm" />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="primary"
                disabled={pending || !(typed[i.id] ?? "").trim()}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await answerBashAsk(i.id, typed[i.id] ?? "");
                    if (!r.ok) return setError(r.error);
                    setTyped((t) => ({ ...t, [i.id]: "" }));
                    router.refresh();
                  })
                }
              >
                Add steps
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { CANT_REPRODUCE };

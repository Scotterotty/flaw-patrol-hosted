"use client";

import { githubRunName } from "@/lib/github-name";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { mb, mediaWords, type MediaCounts } from "@/lib/automation-files";
import { automationCycles, previewAutomation, readAutomationFiles, saveAutomation, type UploadCycle } from "@/server/automation";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, InfoTip, Input } from "./ui";

type Files = { name: string; text: string }[];
type Preview = Extract<Awaited<ReturnType<typeof previewAutomation>>, { ok: true }>;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
type Staged = { stageId: string | null; media: (MediaCounts & { unmatched: number }) | null };
type Picked = { file: File; path: string };

/** Files from a drop, opening dropped folders (Playwright's test-results) with their paths. */
async function dropped(dt: DataTransfer): Promise<Picked[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return [...dt.files].map((file) => ({ file, path: file.name }));
  const out: Picked[] = [];
  const walk = async (e: FileSystemEntry, base: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((ok, no) => (e as FileSystemFileEntry).file(ok, no));
      out.push({ file, path: `${base}${file.name}` });
      return;
    }
    const reader = (e as FileSystemDirectoryEntry).createReader();
    // readEntries hands them over in batches until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
      if (!batch.length) break;
      for (const c of batch) await walk(c, `${base}${e.name}/`);
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

const PW_CONFIG = `reporter: [['junit', { outputFile: 'results.xml' }]],
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
  trace: 'retain-on-failure',
},`;

/** Under the drop box: the playwright.config lines that make screenshots, videos and replays (ver_93). */
function PlaywrightSetup() {
  return (
    <details className="text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-accent-700 hover:underline">How to set up Playwright for screenshots, videos and replays</summary>
      <p className="mt-1.5">
        Add these lines to <span className="font-mono">playwright.config.ts</span>. They tell Playwright to write a results file, and to keep a screenshot, video and replay only when a test fails.
      </p>
      <pre className="mt-1.5 overflow-x-auto rounded bg-slate-900 px-3 py-2 text-[11px] text-slate-100">{PW_CONFIG}</pre>
      <p className="mt-1.5">Then upload results.xml and the test-results folder together, or one zip of both. Flaw Patrol reads Playwright&apos;s JSON report too, if you already make one.</p>
    </details>
  );
}

/** "48 tests · 5 screenshots, 3 videos, 5 replays" and whether they all found their test. */
export function MediaLine({ media }: { media: (MediaCounts & { unmatched: number }) | null }) {
  if (!media) return null;
  const words = mediaWords(media);
  return (
    <p className="text-xs text-slate-600" data-testid="media-line">
      <span aria-hidden>📷</span> {words} ({mb(media.bytes)}).{" "}
      {media.unmatched ? `${media.unmatched} didn't match a test and won't be kept.` : "Every picture, video and replay matched a test."}
    </p>
  );
}

/**
 * Upload automation results (ver_82): drop the JUnit or NUnit XML your automated tests
 * make, pick the test cycle, check how each test matches a case, and save one closed,
 * automated run. Leads and admins, like Import a run.
 */
export function UploadAutomationButton({ scope }: { scope: { groupId: string } | { projectKey: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <span aria-hidden>🤖</span> Upload automation results
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload automation results" wide>
        <Flow scope={scope} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

/** Results already downloaded from a GitHub workflow run (ver_85), going through the same steps. */
export type Pulled = {
  files: Files;
  tests: number;
  build: string;
  groupId: string;
  repoId: string;
  run: { id: string; number: number; url: string };
  /** The workflow's name, for the run's name: "Browser tests · GitHub run 16" (ver_94). */
  workflow?: string;
  /** Already in Flaw Patrol as this run. */
  already: { key: string; number: number } | null;
} & Partial<Staged>;

export function Flow({ scope, onClose, pulled, onBack }: { scope: { groupId: string } | { projectKey: string }; onClose: () => void; pulled?: Pulled; onBack?: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<"drop" | "cycle" | "check">(pulled ? "cycle" : "drop");
  const [files, setFiles] = useState<Files>(pulled?.files ?? []);
  const [staged, setStaged] = useState<Staged>({ stageId: pulled?.stageId ?? null, media: pulled?.media ?? null });
  const [summary, setSummary] = useState<{ tests: number; build: string } | null>(pulled ? { tests: pulled.tests, build: pulled.build } : null);
  const [cycles, setCycles] = useState<UploadCycle[] | null>(null);
  const [cycleId, setCycleId] = useState("");
  const [build, setBuild] = useState(pulled?.build ?? "");
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("");
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [makeCases, setMakeCases] = useState(true);
  const [dupAsk, setDupAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  // Pulled from GitHub: the file is in hand, so load the test cycles straight away.
  useEffect(() => {
    if (!pulled) return;
    automationCycles(scope).then((res) => {
      if (!res.ok) return setError(res.error);
      setCycles(res.cycles);
      if (res.cycles.length === 1) setCycleId(res.cycles[0].id);
    });
    // Once, when the pulled file arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** After the files are read (as text, or staged with their pictures): load the test cycles and move on. */
  const opened = async (read: Files, res: { tests: number; build: string }, stage: Staged) => {
    const opts = cycles ? null : await automationCycles(scope);
    if (opts && !opts.ok) return setError(opts.error);
    const list = opts?.ok ? opts.cycles : cycles!;
    setCycles(list);
    setFiles(read);
    setStaged(stage);
    setSummary({ tests: res.tests, build: res.build });
    setBuild(res.build);
    // Opened from inside a test cycle: that one is picked for you (ver_85).
    const here = "projectKey" in scope ? list.find((c) => c.key === scope.projectKey.toUpperCase()) : undefined;
    if (list.length === 1) setCycleId(list[0].id);
    else if (here && !cycleId) setCycleId(here.id);
    setStep("cycle");
  };

  const take = (picked: Picked[]) => {
    if (!picked.length) return;
    const plain = picked.every((p) => /\.(xml|json)$/i.test(p.path));
    if (!plain && picked.some((p) => !/\.(xml|json|zip|png|jpe?g|gif|webp|webm|mp4|md|txt)$/i.test(p.path) && !/\/\./.test(p.path))) return setError("Upload the results file (.xml), a zip, or Playwright's test-results folder.");
    const total = picked.reduce((n, p) => n + p.file.size, 0);
    if (total > (plain ? MAX_BYTES : MAX_ZIP_BYTES)) return setError(plain ? "Those files are over 50 MB together. Upload fewer at a time." : "That's over 200 MB. Upload the results file and fewer pictures at a time.");
    start(async () => {
      setError(null);
      if (plain) {
        const read = await Promise.all(picked.map(async (p) => ({ name: p.file.name, text: await p.file.text() })));
        const res = await readAutomationFiles(read);
        if (!res.ok) return setError(res.error);
        return opened(read, res, { stageId: null, media: null });
      }
      // A zip or a folder: the server opens it and keeps the pictures until Save (ver_93).
      const form = new FormData();
      for (const p of picked) {
        form.append("file", p.file);
        form.append("path", p.path);
      }
      const r = await fetch("/api/automation/stage", { method: "POST", body: form }).catch(() => null);
      const res = r ? await r.json().catch(() => null) : null;
      if (!res?.ok) return setError(res?.error ?? "Those files couldn't be uploaded. Try again.");
      return opened(res.files, res, { stageId: res.stageId, media: res.media });
    });
  };

  const cycle = cycles?.find((c) => c.id === cycleId);
  const autoName = pulled ? githubRunName(pulled.workflow ?? "", pulled.run.number) : ["Automation", cycle?.name, build && `build ${build}`].filter(Boolean).join(" · ");

  const check = () =>
    start(async () => {
      setError(null);
      const res = await previewAutomation(cycleId, files, {}, staged.stageId ?? undefined);
      if (!res.ok) return setError(res.error);
      setPreview(res);
      setLinks({});
      setStep("check");
    });

  const save = (allowDuplicate: boolean) =>
    start(async () => {
      setError(null);
      const res = await saveAutomation(cycleId, files, { name, build, environment, links, makeCases, allowDuplicate, ...(staged.stageId && { stageId: staged.stageId }), ...(pulled && { github: { repoId: pulled.repoId, runId: pulled.run.id } }) });
      if (!res.ok) return setError(res.error);
      onClose();
      router.push(`/p/${res.key}/runs/${res.number}`);
    });

  return (
    <div className="space-y-4">
      <ol className="flex gap-3 text-xs text-slate-500" aria-label="Steps">
        {[pulled ? "Pick a GitHub run" : "Drop the file", "Pick the test cycle", "Check and save"].map((label, i) => (
          <li key={label} className={cx(["drop", "cycle", "check"].indexOf(step) === i && "font-semibold text-accent-700")} aria-current={["drop", "cycle", "check"].indexOf(step) === i ? "step" : undefined}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>

      {step === "drop" && (
        <>
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            The results file your automated tests make, from your CI build&apos;s artifacts or your test folder. Add the test-results folder, or one zip of both, to bring in screenshots, videos and replays.
            <InfoTip text="Reads JUnit XML (what most test tools and CI servers write), NUnit XML (what .NET and Unity test runners write) and Playwright's JSON report. Several files from one build become one run." />
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const dt = e.dataTransfer;
              void dropped(dt).then(take);
            }}
            className={cx("rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm", over ? "border-accent-500 bg-accent-50" : "border-slate-300")}
          >
            <p className="text-slate-700">
              📄 Drop your results file, the test-results folder, or one zip of both, or{" "}
              <button type="button" className="font-medium text-accent-700 hover:underline" onClick={() => input.current?.click()}>
                pick files
              </button>{" "}
              or a{" "}
              <button type="button" className="font-medium text-accent-700 hover:underline" onClick={() => folder.current?.click()}>
                folder
              </button>
            </p>
            <p className="mt-1 text-xs text-slate-500">JUnit or NUnit XML, Playwright JSON, or a zip · up to 50 MB, or 200 MB with pictures</p>
            <input ref={input} type="file" accept=".xml,.json,.zip,text/xml,application/xml,application/zip,image/*,video/*" multiple hidden aria-label="Results files" onChange={(e) => take([...(e.target.files ?? [])].map((file) => ({ file, path: file.name })))} />
            <input
              ref={folder}
              type="file"
              multiple
              hidden
              aria-label="Results folder"
              {...({ webkitdirectory: "" } as Record<string, string>)}
              onChange={(e) => take([...(e.target.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name })))}
            />
            {pending && <p className="mt-2 text-xs text-slate-500">Reading…</p>}
          </div>
          <PlaywrightSetup />
          <div className="flex justify-end">
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </>
      )}

      {step === "cycle" && summary && !cycles && !error && <p className="py-4 text-center text-sm text-slate-500">Loading test cycles…</p>}

      {step === "cycle" && summary && cycles && (
        <>
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="min-w-0 flex-1">
              📄 <b>{files.map((f) => f.name).join(", ")}</b>
              {pulled && ` from GitHub run ${pulled.run.number}`} · {summary.tests} {summary.tests === 1 ? "test" : "tests"}
              {summary.build && !pulled && ` · build ${summary.build} found in the file`}
            </span>
            <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onClick={() => (pulled ? onBack?.() : setStep("drop"))}>
              {pulled ? "Pick another run" : "Change file"}
            </button>
          </p>
          <MediaLine media={staged.media} />
          {pulled?.already && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              GitHub run {pulled.run.number}&apos;s results are already in Flaw Patrol as Run {pulled.already.number}. Saving makes a second run.
            </p>
          )}
          <section aria-labelledby="au-cycle">
            <h3 id="au-cycle" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              Which test cycle did these run on?
              <InfoTip text="The release comes from the test cycle. Only open test cycles you can upload to are listed." />
            </h3>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Test cycle">
              {cycles.map((c) => (
                <label key={c.id} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-3 pl-2 text-sm", cycleId === c.id ? "border-accent-500 bg-accent-50" : "border-slate-200 hover:bg-slate-50")}>
                  <input type="radio" name="au-cycle" checked={cycleId === c.id} onChange={() => setCycleId(c.id)} />
                  <span className="size-2 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </label>
              ))}
            </div>
            {cycle?.rcName && <p className="mt-1 text-xs text-slate-500">Release {cycle.rcName} comes from the test cycle.</p>}
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Build" htmlFor="au-build">
              <Input id="au-build" value={build} onChange={(e) => setBuild(e.target.value)} placeholder="The build that was tested" />
            </Field>
            <Field label="Run name" htmlFor="au-name">
              <Input id="au-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} />
            </Field>
          </div>
          <div>
            <button type="button" className="text-xs text-slate-600 hover:underline" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? "▾" : "▸"} More: environment
            </button>
            {more && (
              <div className="mt-2 max-w-sm">
                <Field label="Environment" htmlFor="au-env">
                  <Input id="au-env" value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="Where the tests ran" />
                </Field>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!cycleId || pending} onClick={check}>
              {pending ? "Matching…" : "Next: check results"}
            </Button>
          </div>
        </>
      )}

      {step === "check" && preview && (
        <Check
          preview={preview}
          build={build}
          cycleName={cycle?.name ?? ""}
          links={links}
          setLinks={setLinks}
          makeCases={makeCases}
          setMakeCases={setMakeCases}
          pending={pending}
          onBack={() => setStep("cycle")}
          onSave={() => (preview.duplicate ? setDupAsk(true) : save(false))}
        />
      )}

      {dupAsk && preview?.duplicate && cycle && (
        <div role="alertdialog" aria-labelledby="au-dup" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p id="au-dup" className="font-semibold">
            This file is already in Flaw Patrol
          </p>
          <p>
            {files.length === 1 ? files[0].name : "These files"} {files.length === 1 ? "was" : "were"} uploaded as Run {preview.duplicate.number} by {preview.duplicate.by} on {new Date(preview.duplicate.at).toLocaleString()}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/p/${cycle.key}/runs/${preview.duplicate.number}`} onClick={onClose} className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700">
              Open Run {preview.duplicate.number}
            </Link>
            <Button disabled={pending} onClick={() => save(true)}>
              Upload it again as a new run
            </Button>
            <Button variant="ghost" onClick={() => setDupAsk(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_LOOK: Record<string, string> = { PASSED: "bg-emerald-50 text-emerald-700", FAILED: "bg-red-50 text-red-700", SKIPPED: "bg-slate-100 text-slate-600" };
const STATUS_WORD: Record<string, string> = { PASSED: "Passed", FAILED: "Failed", SKIPPED: "Skipped" };

function Check({
  preview,
  build,
  cycleName,
  links,
  setLinks,
  makeCases,
  setMakeCases,
  pending,
  onBack,
  onSave,
}: {
  preview: Preview;
  build: string;
  cycleName: string;
  links: Record<string, string>;
  setLinks: (fn: (l: Record<string, string>) => Record<string, string>) => void;
  makeCases: boolean;
  setMakeCases: (v: boolean) => void;
  pending: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "new" | "failed">("all");
  const [linking, setLinking] = useState<string | null>(null);
  // Same-title suggestions someone turned down with Make new case.
  const [declined, setDeclined] = useState<Set<string>>(() => new Set());
  // Strong name matches are linked for you (ver_91), so a first upload can't make duplicates.
  const [auto, setAuto] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const strong = preview.rows.filter((r) => !r.match && r.suggest);
    if (!strong.length) return;
    setAuto(new Set(strong.map((r) => r.id)));
    setLinks((l) => ({ ...Object.fromEntries(strong.map((r) => [r.id, r.suggest!.caseId])), ...l }));
  }, [preview, setLinks]);
  const unlink = (ids: string[]) => {
    setLinks((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !ids.includes(k))));
    setDeclined((d) => new Set([...d, ...ids.filter((id) => auto.has(id))]));
    setAuto((a) => new Set([...a].filter((id) => !ids.includes(id))));
  };
  const byId = useMemo(() => new Map(preview.library.map((c) => [c.id, c])), [preview.library]);
  const rows = preview.rows.map((r) => (links[r.id] ? { ...r, match: { caseId: links[r.id], key: byId.get(links[r.id])?.key ?? "", title: byId.get(links[r.id])?.title ?? "", by: "link" as const } } : r));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const found = rows.filter((r) => r.match).length;
  const autoLinked = rows.filter((r) => auto.has(r.id) && links[r.id]).map((r) => r.id);
  const fresh = rows.length - found;
  const shown = rows.filter((r) => (filter === "new" ? !r.match : filter === "failed" ? r.status === "FAILED" : true));
  const saving = makeCases ? rows.length : found;

  return (
    <>
      <div className="space-y-1 text-sm">
        <p className="font-semibold text-slate-900">
          {rows.length} tests{build && ` from build ${build}`} on {cycleName}
        </p>
        <p className="flex flex-wrap gap-2 text-xs">
          <span className={cx("rounded-full px-2 py-0.5", STATUS_LOOK.PASSED)}>{count("PASSED")} Passed</span>
          <span className={cx("rounded-full px-2 py-0.5", STATUS_LOOK.FAILED)}>{count("FAILED")} Failed</span>
          <span className={cx("rounded-full px-2 py-0.5", STATUS_LOOK.SKIPPED)}>{count("SKIPPED")} Skipped</span>
        </p>
        <p className="text-slate-600">
          {autoLinked.length > 0 ? (
            <>
              {found - autoLinked.length > 0 && `${found - autoLinked.length} found their case. `}
              {autoLinked.length} linked to existing cases (we matched them by name; check below).{" "}
            </>
          ) : (
            <>{found} found their case. </>
          )}
          {fresh > 0 &&
            (makeCases ? (
              <>
                {fresh} {fresh === 1 ? "is" : "are"} new and will become Automated cases in the Case library&apos;s Automation folder.
              </>
            ) : (
              <>
                {fresh} with no case will be left out.
              </>
            ))}
        </p>
        {fresh > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={makeCases} onChange={(e) => setMakeCases(e.target.checked)} />
            Make Automated cases for tests with no case
            <InfoTip text="Each goes in the Case library's Automation folder, grouped by a readable name for its test class, and gets the test's name as its Automation ID so the next upload finds it." />
          </label>
        )}
      </div>
      <div className="flex gap-1 border-b border-slate-200 text-sm" role="tablist" aria-label="Show">
        {(
          [
            ["all", `All ${rows.length}`],
            ["new", `New cases ${fresh}`],
            ["failed", `Failed ${count("FAILED")}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cx("-mb-px border-b-2 px-3 py-1.5", filter === k ? "border-accent-600 font-medium text-accent-700" : "border-transparent text-slate-600")}>
            {label}
          </button>
        ))}
      </div>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200" aria-label="Tests">
        {shown.slice(0, 300).map((r) => (
          <li key={r.id} className="px-3 py-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 font-mono text-xs break-all text-slate-700" title={r.id}>
                {r.id}
              </span>
              {r.match ? (
                <span className="min-w-0 text-xs text-slate-600">
                  → <span className="font-mono">{r.match.key}</span> {r.match.title}
                  {r.match.by === "link" && (
                    <>
                      {" "}
                      <span className="text-slate-500">{auto.has(r.id) ? "(matched by name)" : "(you linked it)"}</span>{" "}
                      <button type="button" className="text-accent-700 hover:underline" onClick={() => unlink([r.id])}>
                        Undo
                      </button>
                    </>
                  )}
                </span>
              ) : r.suggest && !declined.has(r.id) ? (
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs" data-testid="auto-suggest">
                  <span className="min-w-0 truncate text-slate-600">
                    Looks like <span className="font-mono">{r.suggest.key}</span> {r.suggest.title}
                  </span>
                  <Button size="sm" variant="primary" onClick={() => setLinks((l) => ({ ...l, [r.id]: r.suggest!.caseId }))}>
                    Link
                  </Button>
                  <Button size="sm" onClick={() => setDeclined((d) => new Set(d).add(r.id))}>
                    Make new case
                  </Button>
                </span>
              ) : (
                <span className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">New case</span>
                  <button type="button" className="text-accent-700 hover:underline" onClick={() => setLinking(linking === r.id ? null : r.id)}>
                    Link to a case…
                  </button>
                </span>
              )}
              <span className={cx("rounded-full px-2 py-0.5 text-xs", STATUS_LOOK[r.status])}>
                {STATUS_WORD[r.status]}
                {r.crashed && " · crashed"}
              </span>
            </div>
            {linking === r.id && (
              <CasePicker
                library={preview.library}
                onPick={(id) => {
                  setLinks((l) => ({ ...l, [r.id]: id }));
                  setLinking(null);
                }}
                onCancel={() => setLinking(null)}
              />
            )}
          </li>
        ))}
        {shown.length > 300 && <li className="px-3 py-2 text-xs text-slate-500">Showing 300 of {shown.length}.</li>}
        {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">Nothing here.</li>}
      </ul>
      {preview.media && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="media-kept">
          <span aria-hidden>📷</span> {mediaWords(preview.media.found)} found.{" "}
          {preview.media.kept.screenshots + preview.media.kept.videos + preview.media.kept.replays
            ? `${preview.media.keep === "failed" ? "Only files for failed and flaky tests are kept" : "Files for every test are kept"} (${mediaWords(preview.media.kept)}, ${mb(preview.media.kept.bytes)}).`
            : "None are kept: they're all for passing tests. Umbrella Settings → Automation can keep every test's files."}
          {preview.media.unmatched > 0 && ` ${preview.media.unmatched} didn't match a test.`}
        </p>
      )}
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        Each result keeps its failure message, stack trace, console output and time.
        <InfoTip text='A test that crashed (an error, not a failed check) is saved as Failed, with "Crashed" at the top of its message.' />
      </p>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
        {autoLinked.length > 1 && (
          <Button variant="ghost" className="mr-auto" onClick={() => unlink(autoLinked)}>
            Undo all {autoLinked.length} links
          </Button>
        )}
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" disabled={pending || !saving} onClick={onSave}>
          {pending ? "Saving…" : `Save ${saving} ${saving === 1 ? "result" : "results"}`}
        </Button>
      </div>
    </>
  );
}

function CasePicker({ library, onPick, onCancel }: { library: { id: string; key: string; title: string }[]; onPick: (id: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const hits = s ? library.filter((c) => c.key.toLowerCase().includes(s) || c.title.toLowerCase().includes(s)).slice(0, 8) : [];
  return (
    <div className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="flex gap-2">
        <Input autoFocus className="h-8" placeholder="Search the case it tests, by key or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find the case" onKeyDown={(e) => e.key === "Escape" && onCancel()} />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {hits.length > 0 && (
        <ul className="mt-1 divide-y divide-slate-100 rounded border border-slate-200 bg-surface">
          {hits.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-2 py-1 text-left text-xs hover:bg-accent-50" onClick={() => onPick(c.id)}>
                <span className="font-mono text-slate-500">{c.key}</span> {c.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {s && !hits.length && <p className="mt-1 text-xs text-slate-500">No case matches.</p>}
    </div>
  );
}

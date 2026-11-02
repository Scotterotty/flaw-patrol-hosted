"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KEEP, MAX_MB, mb, type FileSettings } from "@/lib/automation-files";
import { deleteOlderFiles, deleteRunFiles, previewDeleteOlder, previewDeleteRunFiles, saveFileSettings } from "@/server/automation-files";
import { Modal } from "./modal";
import { useCloseRow } from "./settings-row";
import { Button, ErrorText, Field, Input } from "./ui";

type Preview = { files: number; bytes: number; runs: number; onBugs: number };

function PreviewLine({ p }: { p: Preview }) {
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset" role="status" data-testid="delete-preview">
      {p.files
        ? `This deletes ${p.files} ${p.files === 1 ? "file" : "files"} from ${p.runs} ${p.runs === 1 ? "run" : "runs"} and frees ${mb(p.bytes)}. Results, errors and steps stay.`
        : "There's nothing to delete there."}
      {p.onBugs > 0 && ` ${p.onBugs} ${p.onBugs === 1 ? "file is" : "files are"} on a bug, so ${p.onBugs === 1 ? "it stays" : "they stay"}.`}
    </p>
  );
}

/**
 * Umbrella Settings → Screenshots, videos and replays. Files are kept for good:
 * nothing is deleted unless someone deletes it, and files on a bug can't be.
 */
export function AutomationFilesPanel({ groupId, settings, usage, canEdit }: { groupId: string; settings: FileSettings; usage: { bytes: number; runs: number; perDay: number }; canEdit: boolean }) {
  const router = useRouter();
  const close = useCloseRow();
  const [s, setS] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="space-y-4">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <p className="text-sm text-slate-600">Files are kept for good. Nothing is deleted unless someone deletes it, and files linked to a bug can&apos;t be deleted, so a bug never loses its proof.</p>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-600">Keep files for</legend>
        <div className="space-y-1.5">
          {KEEP.map((k) => (
            <label key={k.id} className="flex items-start gap-2 text-sm text-slate-800">
              <input type="radio" name="keep" className="mt-1" checked={s.keep === k.id} disabled={!canEdit} onChange={() => setS({ ...s, keep: k.id })} />
              <span>
                {k.label}
                <span className="block text-xs text-slate-500">{k.tip}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-600">Largest file to keep</legend>
        <div className="flex gap-2" role="radiogroup">
          {MAX_MB.map((n) => (
            <label key={n} className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-sm has-[:checked]:border-accent-500 has-[:checked]:bg-accent-50">
              <input type="radio" name="max" checked={s.maxMb === n} disabled={!canEdit} onChange={() => setS({ ...s, maxMb: n })} />
              {n} MB
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-sm text-slate-700" data-testid="storage-usage">
        Using <b>{mb(usage.bytes)}</b> for {usage.runs} {usage.runs === 1 ? "run" : "runs"}.{usage.perDay > 0 && ` About ${mb(usage.perDay)} a day at the current pace.`}
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveFileSettings(groupId, s);
                if (!r.ok) return setError(r.error);
                setError(null);
                router.refresh();
                close();
              })
            }
          >
            Save
          </Button>
          <Button onClick={close}>Cancel</Button>
          <Button className="ml-auto" onClick={() => setDeleting(true)} disabled={!usage.bytes}>
            Delete files from runs older than…
          </Button>
        </div>
      )}
      <Modal open={deleting} onClose={() => setDeleting(false)} title="Delete files from older runs">
        <DeleteOlder groupId={groupId} onDone={() => setDeleting(false)} />
      </Modal>
    </div>
  );
}

function DeleteOlder({ groupId, onDone }: { groupId: string; onDone: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Delete files from older runs</h2>
      <p className="text-sm text-slate-600">Screenshots, videos and replays from runs before this date are deleted. Each run keeps its results, errors and step list.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Field label="Runs older than" htmlFor="del-before">
        <Input
          id="del-before"
          type="date"
          value={date}
          className="w-44"
          onChange={(e) => {
            setDate(e.target.value);
            setPreview(null);
          }}
        />
      </Field>
      {preview && <PreviewLine p={preview} />}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        {!preview ? (
          <Button
            variant="primary"
            disabled={pending || !date}
            onClick={() =>
              start(async () => {
                const r = await previewDeleteOlder(groupId, date);
                if (!r.ok) return setError(r.error);
                setPreview(r);
              })
            }
          >
            {pending ? "Checking…" : "Show what this frees"}
          </Button>
        ) : (
          <Button
            variant="danger"
            disabled={pending || !preview.files}
            onClick={() =>
              start(async () => {
                const r = await deleteOlderFiles(groupId, date);
                if (!r.ok) return setError(r.error);
                router.refresh();
                onDone();
              })
            }
          >
            Delete {preview.files} {preview.files === 1 ? "file" : "files"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A run's ⋯ → Delete files: previews first, files on a bug stay. */
export function DeleteRunFiles({ runId }: { runId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
          setPreview(null);
          start(async () => {
            const r = await previewDeleteRunFiles(runId);
            if (!r.ok) return setError(r.error);
            setPreview(r);
          });
        }}
      >
        Delete files
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete this run's files">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Delete this run&apos;s screenshots, videos and replays?</h2>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {preview ? <PreviewLine p={preview} /> : <p className="text-sm text-slate-500">Checking…</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={pending || !preview?.files}
              onClick={() =>
                start(async () => {
                  const r = await deleteRunFiles(runId);
                  if (!r.ok) return setError(r.error);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Delete files
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

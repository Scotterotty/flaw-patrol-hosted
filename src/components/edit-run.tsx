"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateRun } from "@/server/runs";
import { Modal } from "./modal";
import { readRunFields, RunFieldInputs, valuesOf } from "./run-field-inputs";
import type { RunField } from "@/lib/run-fields";
import { Button, ErrorText, Field, Input, Textarea } from "./ui";

export type RunDetails = { name: string; release: string; build: string; cspVersion: string; environment: string; description: string; fields: { id: string; value: string }[] };

/** "Edit details" on a run: fix its name, release, build, run fields, environment or notes after it has started. */
/** `addVersion`: the small "Add version" link beside a run's title when it has none (ver_189). */
export function EditRunButton({ projectId, runId, details, releases, fields, addVersion }: { projectId: string; runId: string; details: RunDetails; releases: string[]; fields: RunField[]; addVersion?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      {addVersion ? (
        <button type="button" className="text-sm font-normal text-accent-700 hover:underline" data-testid="run-add-version" data-howto="run-add-version" onClick={() => setOpen(true)}>
          Add version
        </button>
      ) : (
        <Button variant="ghost" data-howto="run-edit" onClick={() => setOpen(true)}>
          Edit details
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Edit run details">
        <form
          className="space-y-3"
          action={(fd) =>
            start(async () => {
              const res = await updateRun(projectId, runId, {
                name: String(fd.get("name")),
                description: String(fd.get("description") ?? ""),
                build: String(fd.get("build") ?? ""),
                environment: String(fd.get("environment") ?? ""),
                release: String(fd.get("release") ?? ""),
                fields: readRunFields(fd),
              });
              if (!res.ok) return setError(res.error);
              setError(null);
              setOpen(false);
              router.refresh();
            })
          }
        >
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <Field label="Run name" htmlFor="edit-run-name">
            <Input id="edit-run-name" name="name" required defaultValue={details.name} autoFocus={!addVersion} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Release" htmlFor="edit-run-release">
              <Input id="edit-run-release" name="release" defaultValue={details.release} placeholder="e.g. 2.1 or RC 22" list="edit-known-releases" />
              <datalist id="edit-known-releases">
                {releases.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Environment" htmlFor="edit-run-env">
              <Input id="edit-run-env" name="environment" defaultValue={details.environment} placeholder="Where you're testing" />
            </Field>
            <Field label="Version" htmlFor="edit-run-build">
              <Input id="edit-run-build" name="build" defaultValue={details.build} placeholder="e.g. 2.4.2 (812)" autoFocus={addVersion} />
            </Field>
            <RunFieldInputs fields={fields} prefix="edit-run" values={valuesOf(details)} editing />
          </div>
          <Field label="Notes" htmlFor="edit-run-desc">
            <Textarea id="edit-run-desc" name="description" rows={3} defaultValue={details.description} />
          </Field>
          <p className="text-xs text-slate-500">Results stay as they are. If you set a release, Reports and Trends group this run under it.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending} data-howto="run-edit-save">
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

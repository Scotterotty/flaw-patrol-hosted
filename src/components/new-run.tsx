"use client";

import type { ResultStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createRun } from "@/server/runs";
import { Modal } from "./modal";
import { readRunFields, RunFieldInputs } from "./run-field-inputs";
import type { RunField } from "@/lib/run-fields";
import { Button, ErrorText, Field, Input, Select, Textarea } from "./ui";

export type RunSource =
  | { kind: "suite"; suiteId: string }
  | { kind: "cases"; caseIds: string[] }
  | { kind: "rerun"; runId: string; statuses: ResultStatus[] };

export type Member = { id: string; name: string };

export function NewRunButton({
  projectId,
  projectKey,
  source,
  defaultName,
  members,
  label = "Start test run",
  variant = "primary",
  defaults,
  disabled,
  releases,
  suiteVersion,
  initialOpen = false,
  openRunner = false,
  meId,
  fields = [],
}: {
  /** The signed-in person, so cases go to them unless they pick someone else. */
  meId?: string;
  projectId: string;
  projectKey: string;
  source: RunSource;
  defaultName: string;
  members: Member[];
  label?: string;
  variant?: "primary" | "secondary";
  defaults?: { build?: string; cspVersion?: string; environment?: string; release?: string; fields?: Record<string, string> };
  /** The umbrella's run fields (ver_89); CSP version outside an umbrella. */
  fields?: RunField[];
  disabled?: boolean;
  releases?: string[];
  suiteVersion?: number;
  /** Open the dialog straight away, e.g. when arriving from "Start a run" on the runs page. */
  initialOpen?: boolean;
  /** Go straight to testing once it starts, e.g. "Start session now" on a charter. */
  openRunner?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen && !disabled);
  const [error, setError] = useState<string | null>(null);
  // Nothing carries over from the last run (ver_77): cases start unassigned.
  const [assignee, setAssignee] = useState("");
  const [goTest, setGoTest] = useState(true);
  const openFresh = () => {
    setAssignee("");
    setGoTest(true);
    setError(null);
    setOpen(true);
  };
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button variant={variant} onClick={openFresh} disabled={disabled}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <form
          className="space-y-3"
          action={(fd) =>
            start(async () => {
              const res = await createRun(projectId, source, {
                name: String(fd.get("name")),
                description: String(fd.get("description") ?? ""),
                build: String(fd.get("build") ?? ""),
                environment: String(fd.get("environment") ?? ""),
                release: String(fd.get("release") ?? ""),
                assigneeId: assignee || null,
                fields: readRunFields(fd),
              });
              if (!res.ok) return setError(res.error);
              setOpen(false);
              // Handed to someone else (ver_85): land on the run page with a link to send them.
              const handed = assignee && assignee !== meId ? `?handed=${assignee}` : "";
              router.push(`/p/${projectKey}/runs/${res.number}${openRunner || goTest ? "/execute" : handed}`);
            })
          }
        >
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <Field label="Run name" htmlFor="run-name">
            <Input id="run-name" name="name" required defaultValue={defaultName} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Release" htmlFor="run-release">
              <Input id="run-release" name="release" defaultValue={defaults?.release} placeholder="e.g. 2.1 or RC 22" list="known-releases" />
              <datalist id="known-releases">
                {releases?.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Environment" htmlFor="run-env">
              <Input id="run-env" name="environment" defaultValue={defaults?.environment} placeholder="Where you're testing" />
            </Field>
            <Field label="Build" htmlFor="run-build">
              <Input id="run-build" name="build" defaultValue={defaults?.build} placeholder="Build number" />
            </Field>
            <RunFieldInputs fields={fields} prefix="run" values={{ csp: defaults?.cspVersion ?? "", ...defaults?.fields }} />
          </div>
          {suiteVersion && <p className="text-xs text-slate-500">Runs version {suiteVersion} of the suite.</p>}
          <Field label="Assign every case to" htmlFor="run-assignee" hint="Or leave it and share cases out on the run page: tick cases, then Assign selected to…">
            <Select
              id="run-assignee"
              name="assignee"
              value={assignee}
              onChange={(e) => {
                setAssignee(e.target.value);
                // Every case going to someone else: you're handing it off, not testing it.
                setGoTest(!e.target.value || e.target.value === meId);
              }}
            >
              <option value="">Nobody yet</option>
              {meId && members.some((m) => m.id === meId) && <option value={meId}>Me ({members.find((m) => m.id === meId)!.name})</option>}
              {members
                .filter((m) => m.id !== meId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="run-desc">
            <Textarea id="run-desc" name="description" rows={2} />
          </Field>
          {!openRunner && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="accent-accent-600" checked={goTest} onChange={(e) => setGoTest(e.target.checked)} />
              Open the first case when it starts
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Starting…" : openRunner ? "Start session" : "Start run"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

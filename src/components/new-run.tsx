"use client";

import { assignable } from "@/lib/assignable";
import type { ResultStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createRun } from "@/server/runs";
import { Modal } from "./modal";
import { AutomatedBadge } from "./badges";
import { readRunFields, RunFieldInputs } from "./run-field-inputs";
import type { RunField } from "@/lib/run-fields";
import { Button, ErrorText, Field, Input, Select, Textarea } from "./ui";

export type RunSource =
  | { kind: "suite"; suiteId: string }
  | { kind: "cases"; caseIds: string[] }
  | { kind: "rerun"; runId: string; statuses: ResultStatus[] };

export type Member = { id: string; name: string; canTest?: boolean };

export function NewRunButton({
  projectId,
  projectKey,
  source,
  defaultName,
  members,
  label = "Start test run",
  variant = "primary",
  suggest,
  disabled,
  releases,
  suiteVersion,
  initialOpen = false,
  openRunner = false,
  meId,
  fields = [],
  autoCases = 0,
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
  /** An earlier run's details, offered as "Use R19's" instead of filled in. */
  suggest?: { from: string; build?: string; cspVersion?: string; environment?: string; release?: string; fields?: Record<string, string> };
  /** The umbrella's run fields; CSP version outside an umbrella. */
  fields?: RunField[];
  disabled?: boolean;
  releases?: string[];
  suiteVersion?: number;
  /** Open the dialog straight away, e.g. when arriving from "Start a run" on the runs page. */
  initialOpen?: boolean;
  /** Go straight to testing once it starts, e.g. "Start session now" on a charter. */
  openRunner?: boolean;
  /** Automated-only cases in the suite: left out unless "Also include" is ticked. */
  autoCases?: number;
}) {
  const [open, setOpen] = useState(initialOpen && !disabled);
  const [error, setError] = useState<string | null>(null);
  // Nothing carries over from the last run: cases start unassigned.
  const [assignee, setAssignee] = useState("");
  const openFresh = () => {
    setAssignee("");
    setError(null);
    setOpen(true);
  };
  const handed = !!assignee && assignee !== meId;
  // "Use R19's": fills the empty boxes with that run's details, only when asked.
  const offered = suggest
    ? [
        ["run-release", suggest.release],
        ["run-env", suggest.environment],
        ["run-build", suggest.build],
        ["run-csp", suggest.cspVersion],
        ...Object.entries(suggest.fields ?? {}).map(([id, v]) => [`run-f-${id}`, v]),
      ].filter((x): x is [string, string] => !!x[1]?.trim())
    : [];
  const useSuggested = () => {
    for (const [id, v] of offered) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && !el.value.trim()) el.value = v;
    }
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
              const goTest = fd.get("go") === "test";
              const res = await createRun(projectId, source, {
                name: String(fd.get("name") ?? "").trim() || defaultName,
                description: String(fd.get("description") ?? ""),
                build: String(fd.get("build") ?? ""),
                environment: String(fd.get("environment") ?? ""),
                release: String(fd.get("release") ?? ""),
                assigneeId: assignee || null,
                fields: readRunFields(fd),
                withAutomated: fd.get("with-auto") === "on",
              });
              if (!res.ok) return setError(res.error);
              setOpen(false);
              // Handed to someone else: land on the run page with a link to send them.
              router.push(`/p/${projectKey}/runs/${res.number}${openRunner || goTest ? "/execute" : handed ? `?handed=${assignee}` : ""}`);
            })
          }
        >
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <Field label="Run name (optional)" htmlFor="run-name" hint="Leave it blank to use the suggested name shown.">
            <Input id="run-name" name="name" placeholder={defaultName} autoFocus />
          </Field>
          {offered.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900" data-testid="run-suggest">
              <span>
                {suggest!.from} used {offered.map(([, v]) => v).join(", ")}.
              </span>
              <Button size="sm" onClick={useSuggested}>
                Use {suggest!.from}&apos;s
              </Button>
            </p>
          )}
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field label="Release" htmlFor="run-release">
              <Input id="run-release" name="release" placeholder="e.g. 2.1 or RC 22" list="known-releases" />
              <datalist id="known-releases">
                {releases?.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Environment" htmlFor="run-env">
              <Input id="run-env" name="environment" placeholder="Where you're testing" />
            </Field>
            <Field label="Build" htmlFor="run-build">
              <Input id="run-build" name="build" placeholder="Build number" />
            </Field>
            <RunFieldInputs fields={fields} prefix="run" />
          </div>
          {suiteVersion && <p className="text-xs text-slate-500">Runs version {suiteVersion} of the suite.</p>}
          {autoCases > 0 && (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="with-auto">
              <input type="checkbox" name="with-auto" className="mt-1" />
              <span className="min-w-0">
                Also include the {autoCases === 1 ? "automated case" : `${autoCases} automated cases`} <AutomatedBadge tip="Made from automation results. Automation already runs these." />
                <span className="block text-xs text-slate-500">
                  Your automation already runs {autoCases === 1 ? "it" : "these"} and sends the results in. Tick this only if someone will check {autoCases === 1 ? "it" : "them"} by hand too.
                </span>
              </span>
            </label>
          )}
          <Field label="Assign every case to" htmlFor="run-assignee" hint="Or leave it and share cases out on the run page: tick cases, then Assign selected to…">
            <Select
              id="run-assignee"
              name="assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Nobody yet</option>
              {meId && assignable(members).some((m) => m.id === meId) && <option value={meId}>Me ({members.find((m) => m.id === meId)!.name})</option>}
              {assignable(members)
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            {openRunner ? (
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Starting…" : "Start session"}
              </Button>
            ) : (
              <>
                <Button type="submit" name="go" value="page" disabled={pending}>
                  Start run
                </Button>
                {/* Handing every case to someone else: no "test now" for you. */}
                {!handed && (
                  <Button type="submit" name="go" value="test" variant="primary" disabled={pending}>
                    {pending ? "Starting…" : "Start and test now"}
                  </Button>
                )}
              </>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MAX_RUN_FIELDS, type RunField } from "@/lib/run-fields";
import { setRunFields } from "@/server/umbrella";
import { Badge, Button, ErrorText, Field, Input, Select } from "./ui";

/** Umbrella Settings → Run fields (ver_89): the extra details runs ask for. Saves on each add or remove. */
export function RunFieldsPanel({ groupId, umbrella, fields: initial, canEdit }: { groupId: string; umbrella: string; fields: RunField[]; canEdit: boolean }) {
  const [fields, setFields] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<"text" | "list">("text");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = (next: RunField[] | Omit<RunField, "id">[], after?: () => void) =>
    start(async () => {
      const r = await setRunFields(groupId, next);
      if (!r.ok) return setError(r.error);
      setError(null);
      setFields(r.fields);
      after?.();
      router.refresh();
    });
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        What people fill in when they start a run in any {umbrella} test cycle.
      </p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Always there</p>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {[
            ["Release", "Groups runs by release. Leave it blank for other testing."],
            ["Build", ""],
            ["Environment", ""],
          ].map(([n, sub]) => (
            <li key={n} className="flex items-center gap-2 px-3 py-2">
              <span className="font-medium text-slate-900">{n}</span>
              <Badge>Built in</Badge>
              {sub && <span className="text-xs text-slate-500">{sub}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Your fields</p>
        {fields.length ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Your run fields">
            {fields.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium text-slate-900">{f.name}</span>
                <span className="text-xs text-slate-500">{f.type === "list" ? `Pick from list: ${f.choices.join(", ")}` : "Text"}</span>
                {f.required && <Badge tone="orange">Required</Badge>}
                {f.rc && <Badge tone="blue">On Release status</Badge>}
                {f.jira && <Badge tone="violet">In Jira bugs</Badge>}
                <span className="flex-1" />
                {canEdit && (
                  <Button size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${f.name}`} onClick={() => save(fields.filter((x) => x.id !== f.id))}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-slate-500">No extra fields yet. Add one if your runs need another detail, like a firmware or API version.</p>
        )}
        {fields.length > 0 && <p className="mt-1 text-xs text-slate-500">Removing a field hides it on new runs. Runs that already have a value keep it.</p>}
      </div>
      {canEdit &&
        (adding ? (
          <form
            className="space-y-2.5 rounded-lg border border-slate-200 p-3"
            aria-label="Add a run field"
            action={(fd) => {
              const choices = String(fd.get("choices") ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              save(
                [
                  ...fields,
                  { name: String(fd.get("name") ?? ""), type, choices, required: fd.get("required") === "on", rc: fd.get("rc") === "on", jira: fd.get("jira") === "on" },
                ],
                () => {
                  setAdding(false);
                  setType("text");
                },
              );
            }}
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Field name" htmlFor="rf-name">
                <Input id="rf-name" name="name" required maxLength={40} autoFocus placeholder="For example Firmware" />
              </Field>
              <Field label="Type" htmlFor="rf-type">
                <Select id="rf-type" value={type} onChange={(e) => setType(e.target.value as "text" | "list")}>
                  <option value="text">Text</option>
                  <option value="list">Pick from a list</option>
                </Select>
              </Field>
            </div>
            {type === "list" && (
              <Field label="Choices, comma separated" htmlFor="rf-choices">
                <Input id="rf-choices" name="choices" required placeholder="EU, US, APAC" />
              </Field>
            )}
            <div className="space-y-1.5">
              {[
                ["required", "Required when starting a run"],
                ["rc", "Show on Release status cards"],
                ["jira", "Add to Jira bugs filed from these runs"],
              ].map(([n, label]) => (
                <label key={n} className="flex items-center gap-2 text-slate-800">
                  <input type="checkbox" name={n} className="accent-accent-600" defaultChecked={n !== "required"} />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={pending}>
                {pending ? "Adding…" : "Add field"}
              </Button>
              <Button size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : fields.length < MAX_RUN_FIELDS ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            ＋ Add a field
          </Button>
        ) : (
          <p className="text-xs text-slate-500">{MAX_RUN_FIELDS} fields is the most an umbrella can have.</p>
        ))}
    </div>
  );
}

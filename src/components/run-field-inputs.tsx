"use client";

import type { RunField } from "@/lib/run-fields";
import { Field, Input, Select } from "./ui";

/** The umbrella's run fields in a run form (ver_89). CSP version keeps its old box id. */
export function RunFieldInputs({ fields, values, prefix, editing = false }: { fields: RunField[]; values?: Record<string, string>; prefix: string; editing?: boolean }) {
  return (
    <>
      {fields.map((f) => {
        const id = f.id === "csp" ? `${prefix}-csp` : `${prefix}-f-${f.id}`;
        const value = values?.[f.id] ?? "";
        // Editing a run made before a field was required doesn't force it.
        const required = f.required && !editing;
        return (
          <Field key={f.id} label={f.required ? `${f.name} *` : f.name} htmlFor={id}>
            {f.type === "list" && f.choices.length ? (
              <Select id={id} name={`field.${f.id}`} defaultValue={value} required={required}>
                <option value="">{f.required ? `Pick ${f.name}` : "None"}</option>
                {/* A value picked before the choices changed stays pickable. */}
                {value && !f.choices.includes(value) && <option value={value}>{value}</option>}
                {f.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={id} name={`field.${f.id}`} defaultValue={value} placeholder={f.name} maxLength={200} required={required} />
            )}
          </Field>
        );
      })}
    </>
  );
}

/** What was typed into RunFieldInputs, by field id. */
export function readRunFields(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("field.")) out[k.slice(6)] = String(v);
  return out;
}

/** A run's current values, by field id, for an edit form. */
export function valuesOf(run: { cspVersion: string; fields: { id: string; value: string }[] }) {
  return { csp: run.cspVersion, ...Object.fromEntries(run.fields.map((f) => [f.id, f.value])) };
}

/**
 * Run fields (ver_89): the extra details an umbrella's runs ask for, beyond the
 * built-in Release, Build and Environment. Umbrellas made before ver_89 start with
 * CSP version (id "csp", stored in TestRun.cspVersion); new umbrellas start with none.
 * Test cycles outside any umbrella keep CSP version.
 */
export type RunField = {
  id: string;
  name: string;
  type: "text" | "list";
  /** For "list": the choices, in order. */
  choices: string[];
  /** Required when starting a run. */
  required: boolean;
  /** Shown on Release status cards. */
  rc: boolean;
  /** Added to Jira bugs filed from these runs. */
  jira: boolean;
};

/** A filled-in field on a run, with the field's name when the run was made or edited. */
export type RunFieldValue = { id: string; name: string; value: string };

export const MAX_RUN_FIELDS = 5;
export const CSP_FIELD: RunField = { id: "csp", name: "CSP version", type: "text", choices: [], required: false, rc: true, jira: true };

export function parseRunFields(v: unknown): RunField[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && typeof (f as { id?: unknown }).id === "string" && typeof (f as { name?: unknown }).name === "string")
    .map((f) => ({
      id: String(f.id),
      name: String(f.name),
      type: f.type === "list" ? ("list" as const) : ("text" as const),
      choices: Array.isArray(f.choices) ? f.choices.map(String) : [],
      required: !!f.required,
      rc: !!f.rc,
      jira: !!f.jira,
    }))
    .slice(0, MAX_RUN_FIELDS);
}

export function parseFieldValues(v: unknown): RunFieldValue[] {
  if (!Array.isArray(v)) return [];
  return v.filter((f) => f && typeof f === "object" && typeof f.id === "string").map((f) => ({ id: String(f.id), name: String(f.name ?? ""), value: String(f.value ?? "") }));
}

/** Every filled-in field on a run, CSP version first, with its value. */
export function runValues(run: { cspVersion: string; fields?: unknown }, defs?: RunField[]): RunFieldValue[] {
  const csp = defs?.find((d) => d.id === CSP_FIELD.id);
  const out: RunFieldValue[] = run.cspVersion ? [{ id: CSP_FIELD.id, name: csp?.name ?? CSP_FIELD.name, value: run.cspVersion }] : [];
  for (const f of parseFieldValues(run.fields)) if (f.value) out.push({ ...f, name: defs?.find((d) => d.id === f.id)?.name ?? f.name });
  return out;
}

/** Short bits for a run's meta line: "CSP 0.22.1", "Firmware 3.1". */
export function fieldBits(run: { cspVersion: string; fields?: unknown }): string[] {
  return runValues(run).map((f) => (f.id === CSP_FIELD.id ? `CSP ${f.value}` : `${f.name} ${f.value}`));
}

/** Fields shown on Release status cards or added to Jira bugs. */
export function pickValues(run: { cspVersion: string; fields?: unknown }, defs: RunField[], where: "rc" | "jira"): RunFieldValue[] {
  return runValues(run, defs).filter((v) => {
    const d = defs.find((x) => x.id === v.id);
    // A field removed from the umbrella still shows on the runs that have it.
    return d ? d[where] : true;
  });
}

/**
 * Check what someone typed against the fields and turn it into what's stored.
 * CSP version goes to its own column; the rest are kept with their names.
 * Throws a plain message when a required field is empty.
 */
export function readFieldInput(defs: RunField[], input: Record<string, string>, opts: { strict?: boolean } = {}) {
  const fields: RunFieldValue[] = [];
  let cspVersion: string | undefined;
  for (const d of defs) {
    const value = (input[d.id] ?? "").trim().slice(0, 200);
    if (opts.strict !== false && d.required && !value) throw new Error(`Fill in ${d.name}.`);
    // Pick-list fields take a typed value too (ver_99), for a version nobody has added yet.
    if (d.id === CSP_FIELD.id) cspVersion = value;
    else fields.push({ id: d.id, name: d.name, value });
  }
  return { cspVersion, fields };
}

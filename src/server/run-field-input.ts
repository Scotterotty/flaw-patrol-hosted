import { readFieldInput, type RunField } from "@/lib/run-fields";
import { runFieldsFor } from "@/lib/run-fields-server";
import { UserError } from "./result";

/** A run's typed-in fields, checked against its test cycle's run fields (ver_89). */
export async function fieldsOrFail(projectId: string, input: Record<string, string>, opts: { strict?: boolean; defs?: RunField[] } = {}) {
  const defs = opts.defs ?? (await runFieldsFor(projectId));
  try {
    return { defs, ...readFieldInput(defs, input, opts) };
  } catch (e) {
    throw new UserError((e as Error).message);
  }
}

import type { RunKindDef } from "@/lib/run-kinds";
import { Select } from "./ui";

/** Kind filter (ver_95) for Test runs and Reports: any kind, one kind, or plain runs. */
export function KindSelect({ kinds, value, name = "kind" }: { kinds: RunKindDef[]; value?: string; name?: string }) {
  return (
    <Select name={name} defaultValue={value ?? ""} aria-label="Kind of run" className="w-auto">
      <option value="">Any kind</option>
      {kinds.map((k) => (
        <option key={k.id} value={k.id}>
          {k.name}
        </option>
      ))}
      <option value="none">Run (no kind)</option>
    </Select>
  );
}

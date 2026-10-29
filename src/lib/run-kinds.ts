import { z } from "zod";

// Run kinds (ver_95). Start a run first asks what kind of run it is. Three come
// built in: Smoke test and Release candidate (rename or hide them), and Bug bash.
// Teams add their own, each with an optional usual suite that fills in "What to run".
// The kind is saved on the run (TestRun.kind); "" is a plain run, shown as "Run".

export type RunKindDef = { id: string; name: string; suiteId: string | null; builtIn: boolean; hidden: boolean };

export const BUILT_IN_KINDS: { id: string; name: string; renamable: boolean }[] = [
  { id: "smoke", name: "Smoke test", renamable: true },
  { id: "rc", name: "Release candidate", renamable: true },
  { id: "bash", name: "Bug bash", renamable: false },
];

const stored = z.array(
  z.object({
    id: z.string().min(1).max(40),
    name: z.string().max(60).default(""),
    suiteId: z.string().nullable().default(null),
    hidden: z.boolean().default(false),
  }),
);

/** The umbrella's kinds, built-ins first, from ProjectGroup.runKinds. */
export function parseRunKinds(v: unknown): RunKindDef[] {
  const parsed = stored.safeParse(v);
  const list = parsed.success ? parsed.data : [];
  const built = BUILT_IN_KINDS.map((b) => {
    const saved = list.find((k) => k.id === b.id);
    return { id: b.id, name: (b.renamable && saved?.name.trim()) || b.name, suiteId: saved?.suiteId ?? null, builtIn: true, hidden: b.renamable ? !!saved?.hidden : false };
  });
  const custom = list.filter((k) => !BUILT_IN_KINDS.some((b) => b.id === k.id) && k.name.trim()).map((k) => ({ id: k.id, name: k.name.trim(), suiteId: k.suiteId, builtIn: false, hidden: !!k.hidden }));
  return [...built, ...custom];
}

/** What a run's kind reads as: its name, or "Run" for a plain run or a kind since removed. */
export function kindLabel(kinds: RunKindDef[], id: string | null | undefined) {
  if (!id) return "Run";
  return kinds.find((k) => k.id === id)?.name ?? BUILT_IN_KINDS.find((b) => b.id === id)?.name ?? "Run";
}

/** A new custom kind's id, from its name: "Regression" is "regression", then "regression-2"… */
export function kindIdFor(name: string, taken: string[]) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "kind";
  for (let i = 1; ; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    if (!taken.includes(id) && !BUILT_IN_KINDS.some((b) => b.id === id)) return id;
  }
}

/** Release status leaves out smoke tests, custom kinds and bug bashes; plain runs still count. */
export const countsForRelease = (kind: string) => kind === "rc" || kind === "";

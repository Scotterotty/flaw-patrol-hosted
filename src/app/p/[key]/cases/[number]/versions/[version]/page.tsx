import { viewerZone } from "@/lib/zone-server";
import { StepsTable, actionCell, expectedCell } from "@/components/steps-table";
import { dateTime } from "@/lib/spelling";
import { parseCharter, reminderLabel } from "@/lib/charter";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityBadge, TagList, TypeBadge } from "@/components/badges";
import { RestoreVersionButton } from "@/components/case-actions";
import { Card } from "@/components/ui";
import { sharedStepDefs } from "@/lib/case-data";
import { diffLists } from "@/lib/diff";
import { caseKey, PRIORITY_LABEL, TYPE_LABEL } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess, mySpelling } from "@/lib/session";
import { parseCaseSteps, sharedStepIdsIn, type CaseStepItem, type SharedStepDef } from "@/lib/steps";
import { loadCase } from "../../load";

export const metadata = { title: "Case version" };

function describe(item: CaseStepItem, defs: Map<string, SharedStepDef>) {
  if (item.kind === "step") return { action: item.action, expected: item.expected, shared: false };
  const name = defs.get(item.sharedStepId)?.name ?? "Missing shared step";
  const params = Object.entries(item.params).filter(([, v]) => v);
  return { action: `Shared: ${name}${params.length ? ` (${params.map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}`, expected: "", shared: true };
}

export default async function CaseVersionPage({ params, searchParams }: { params: Promise<{ key: string; number: string; version: string }>; searchParams: Promise<{ from?: string }> }) {
  const { key, number, version } = await params;
  // ?from=N (ver_96): compare with the copy a run used, from a case's What was updated link.
  const { from } = await searchParams;
  const { project, who } = await projectAccess(key);
  const c = await loadCase(project.id, number);
  const v = c.versions.find((x) => x.version === Number(version));
  if (!v) notFound();
  const prev = c.versions.find((x) => x.version === (from && Number(from) < v.version ? Number(from) : v.version - 1));

  const items = parseCaseSteps(v.steps);
  const prevItems = prev ? parseCaseSteps(prev.steps) : [];
  const defs = new Map(
    (await sharedStepDefs(project.id, sharedStepIdsIn([...items, ...prevItems]))).map((d) => [d.id, d]),
  );
  const diff = diffLists(prevItems, items);

  const fieldChanges: { label: string; from: string; to: string }[] = [];
  if (prev) {
    const cmp = (label: string, a: string, b: string) => a !== b && fieldChanges.push({ label, from: a || "(empty)", to: b || "(empty)" });
    cmp("Title", prev.title, v.title);
    cmp("Priority", PRIORITY_LABEL[prev.priority], PRIORITY_LABEL[v.priority]);
    cmp("Type", TYPE_LABEL[prev.type], TYPE_LABEL[v.type]);
    cmp("Automation ID", prev.automationId ?? "", v.automationId ?? "");
    cmp("Tags", prev.tags.join(", "), v.tags.join(", "));
    cmp("Folder", prev.folderPath, v.folderPath);
    cmp("Preconditions", prev.preconditions, v.preconditions);
    cmp("Persona", prev.personaName, v.personaName);
    if (v.type === "EXPLORATORY" || prev.type === "EXPLORATORY") {
      const a = parseCharter(prev.charter);
      const b = parseCharter(v.charter);
      cmp("Explore", a.explore, b.explore);
      cmp("With", a.with, b.with);
      cmp("To discover", a.discover, b.discover);
      cmp("Time limit", `${a.minutes} min`, `${b.minutes} min`);
      const rem = (c: typeof a) => c.reminders.map((r) => `${reminderLabel(r)}${r.text ? `: ${r.text}` : ""}`).join("; ");
      cmp("Reminders", rem(a), rem(b));
    }
  }
  const stepsChanged = diff.some((d) => d.op !== "same");

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-2 text-xs text-slate-500">
        <Link href={`/p/${project.key}/cases/${c.number}`} className="hover:underline">
          {caseKey(project.key, c.number)}
        </Link>
        {" / "}Version {v.version}
      </nav>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{v.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Version {v.version} of {c.currentVersion} · {v.authorName || "Unknown"} · {dateTime(v.createdAt, await mySpelling(), await viewerZone())}
            {v.changeNote && ` · ${v.changeNote}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={v.priority} />
            <TypeBadge type={v.type} />
            <TagList tags={v.tags} />
            {v.folderPath && <span className="text-xs text-slate-500">{v.folderPath}</span>}
          </div>
        </div>
        {v.version !== c.currentVersion && can(who, "case:edit") && !c.archived && (
          <RestoreVersionButton projectId={project.id} projectKey={project.key} caseId={c.id} number={c.number} version={v.version} />
        )}
      </div>

      {prev && (fieldChanges.length > 0 || stepsChanged) && (
        <Card className="mb-5 p-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Changes from version {prev.version}</h2>
          {fieldChanges.length > 0 && (
            <dl className="mb-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
              {fieldChanges.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-slate-500">{f.label}</dt>
                  <dd>
                    <del className="bg-red-50 text-red-700">{f.from}</del> → <ins className="bg-emerald-50 text-emerald-800 no-underline">{f.to}</ins>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {!stepsChanged && <p className="text-sm text-slate-500">Steps unchanged.</p>}
        </Card>
      )}

      <Card className="overflow-hidden">
        <StepsTable lead compact>
          <tbody className="divide-y divide-slate-100">
            {(() => {
              let n = 0;
              return (prev ? diff : items.map((value) => ({ op: "same" as const, value }))).map((d, i) => {
                const s = describe(d.value, defs);
                if (d.op !== "removed") n++;
                return (
                  <tr
                    key={i}
                    className={d.op === "added" ? "bg-emerald-50" : d.op === "removed" ? "bg-red-50 text-slate-400 line-through" : ""}
                  >
                    <td className="px-3 py-2 text-xs font-semibold">
                      {d.op === "added" ? <span className="text-emerald-700">+</span> : d.op === "removed" ? <span className="text-red-600">−</span> : ""}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{d.op === "removed" ? "" : n}</td>
                    <td className={`px-3 ${actionCell} ${s.shared ? "text-violet-700" : ""}`}>{s.action}</td>
                    <td className={`px-3 ${expectedCell}`}>{s.expected}</td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </StepsTable>
      </Card>
      {items.some((i) => i.kind === "shared") && (
        <p className="mt-2 text-xs text-slate-500">Shared steps are shown by name; open one to see its own version history.</p>
      )}
    </div>
  );
}

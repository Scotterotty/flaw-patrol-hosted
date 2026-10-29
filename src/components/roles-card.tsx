"use client";

import type { Role } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PRESET_LABEL, ROLE_ROWS, roleSummary, rowAllows, type RoleRules, type RolePreset } from "@/lib/permissions";
import { saveRoleRules } from "@/server/roles";
import { useSpell } from "./spelling";
import { Button, Card, cx, ErrorText, InfoTip } from "./ui";

const ROLES: Role[] = ["TESTER", "LEAD", "ADMIN"];
const SHORT: Record<Role, string> = { TESTER: "Member", LEAD: "Lead", ADMIN: "Admin", VIEWER: "Viewer" };
const PRESET_TIP: Record<RolePreset, string> = {
  standard: roleSummary(),
  open: "Members can do everything leads can, and add test cycles, except the Archive and delete rows, which stay with leads and admins.",
  custom: "Tick exactly what each role can do. Ticking any box makes it Custom.",
};

/** Every row's ticked roles for a preset, as the custom table starts from it. */
function tableOf(rules: RoleRules | null): Record<string, Role[]> {
  return Object.fromEntries(ROLE_ROWS.map((row) => [row.id, ROLES.filter((r) => r !== "ADMIN" && rowAllows(row, r, rules))]));
}

/**
 * The Roles card (ver_82), admins only: pick a preset or tick the table. On an umbrella
 * it applies to its Case library and all its test cycles.
 */
export function RolesCard({ target, rules, appliesTo }: { target: { groupId: string } | { projectId: string }; rules: RoleRules | null; appliesTo: string }) {
  const router = useRouter();
  const sp = useSpell();
  const [preset, setPreset] = useState<RolePreset>(rules?.preset ?? "standard");
  const [table, setTable] = useState(() => tableOf(rules));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pick = (p: RolePreset) => {
    setPreset(p);
    if (p !== "custom") setTable(tableOf({ preset: p }));
    setDirty(true);
    setSaved(false);
  };
  const toggle = (rowId: string, role: Role) => {
    setTable((t) => ({ ...t, [rowId]: t[rowId].includes(role) ? t[rowId].filter((r) => r !== role) : [...t[rowId], role] }));
    setPreset("custom");
    setDirty(true);
    setSaved(false);
  };
  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveRoleRules(target, { preset, allow: preset === "custom" ? (table as Record<string, ("TESTER" | "LEAD")[]>) : undefined });
      if (!res.ok) return setError(res.error);
      setDirty(false);
      setSaved(true);
      router.refresh();
    });
  const cancel = () => {
    setPreset(rules?.preset ?? "standard");
    setTable(tableOf(rules));
    setDirty(false);
  };

  let group = "";
  return (
    <Card id="roles" className="scroll-mt-20 space-y-3 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        Roles
        <InfoTip text={`What each role can do. Applies to ${appliesTo}. Admins can always do everything, and only admins see this card.`} />
      </h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preset">
        {(["standard", "open", "custom"] as RolePreset[]).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p}
            title={sp(PRESET_TIP[p])}
            onClick={() => pick(p)}
            className={cx("rounded-md border px-3 py-1.5 text-left text-sm", preset === p ? "border-accent-500 bg-accent-50 font-medium text-accent-800 ring-1 ring-accent-500" : "border-slate-200 text-slate-700 hover:bg-slate-50")}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      {/* Written from the grid below (ver_91), so the two always agree. */}
      <p className="text-sm text-slate-600" data-testid="role-summary">
        {sp(roleSummary(preset === "custom" ? { preset, allow: table } : { preset }))}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] tracking-wide text-slate-500 uppercase">
              <th className="py-1.5 pr-3 font-semibold">Action</th>
              {ROLES.map((r) => (
                <th key={r} className="w-16 px-2 py-1.5 text-center font-semibold">
                  {SHORT[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_ROWS.map((row) => {
              const head = row.group !== group;
              group = row.group;
              return [
                head && (
                  <tr key={`g-${row.group}`}>
                    <td colSpan={4} className="pt-3 pb-1 text-xs font-semibold text-slate-600">
                      {row.group}
                    </td>
                  </tr>
                ),
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 text-slate-800">
                    {row.label}
                    {row.locked && (
                      <span className="ml-1 cursor-help" title="Admins only, always: anyone who could change roles could make themselves an admin." aria-label="Locked to admins">
                        🔒
                      </span>
                    )}
                  </td>
                  {ROLES.map((role) => {
                    const fixed = role === "ADMIN" || !!row.locked;
                    const on = role === "ADMIN" || (!row.locked && table[row.id]?.includes(role));
                    const std = role === "ADMIN" || rowAllows(row, role, null);
                    return (
                      <td key={role} className={cx("px-2 py-1.5 text-center", !fixed && on !== std && "bg-amber-50")}>
                        <input type="checkbox" checked={on} disabled={fixed} onChange={() => toggle(row.id, role)} aria-label={`${row.label}: ${SHORT[role]}`} title={!fixed && on !== std ? "Differs from Standard" : undefined} />
                      </td>
                    );
                  })}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <p className="mb-3 text-xs text-slate-500">
        <span className="font-medium text-slate-700">Viewers</span> aren&apos;t in the table: they see everything, flag cases and join bug bashes (logging bugs there), but don&apos;t edit, run or archive.
      </p>
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-slate-500" aria-live="polite">
          {dirty ? "Not saved yet" : saved ? "Saved" : ""}
        </span>
        {dirty && <Button onClick={cancel}>Cancel</Button>}
        <Button variant="primary" disabled={!dirty || pending} onClick={save}>
          {pending ? "Saving…" : "Save roles"}
        </Button>
      </div>
    </Card>
  );
}

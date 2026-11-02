import { Fragment } from "react";
import { viewerZone } from "@/lib/zone-server";
import { cleanQuery, ENOUGH_EXACT, forgivingFilter } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import Link from "next/link";
import { ACTIVITY_KINDS, KEEP_CHOICES } from "@/lib/activity";
import { activityWhere, DAY_CHOICES, pageSize, type ActivityFilters } from "@/lib/activity-query";
import { db } from "@/lib/db";
import { clockTime, shortDate, type Spelling } from "@/lib/spelling";
import { AutoFilterForm } from "./auto-filter-form";
import { ActivityKeep } from "./activity-keep";
import { Badge, buttonClass, Card, InfoTip, Input, Select, type Tone } from "./ui";

const TONE: Record<string, Tone> = { signin: "orange", people: "blue", settings: "violet", delete: "red", run: "gray" };

/** Workspace settings → Activity log: admin and security events, newest first. */
export async function ActivityLog({ filters, spelling }: { filters: ActivityFilters; spelling: Spelling }) {
  // On the viewer's clock, not the server's UTC.
  const zone = await viewerZone();
  const where = activityWhere(filters);
  const take = pageSize(filters);
  const [entries, total, people, umbrellas, ws] = await Promise.all([
    db.activityEntry.findMany({ where, orderBy: { at: "desc" }, take }),
    db.activityEntry.count({ where }),
    db.user.findMany({ where: { activity: { some: {} } }, select: { id: true, name: true, email: true }, orderBy: [{ name: "asc" }, { email: "asc" }] }),
    db.projectGroup.findMany({ where: { hubProjectId: { not: null } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.workspace.findUnique({ where: { id: 1 }, select: { activityKeepDays: true } }),
  ]);
  // Close matches: "pasword" finds password changes, under their own label.
  const q = filters.q?.trim() ?? "";
  const close =
    q && total < ENOUGH_EXACT && cleanQuery(q).length > 1
      ? forgivingFilter(await db.activityEntry.findMany({ where: activityWhere({ ...filters, q: "" }), orderBy: { at: "desc" }, take: 3000 }), q, (e) => `${e.action} ${e.detail} ${e.actorLabel} ${e.where}`, (e) => `${e.action} ${e.actorLabel} ${e.where}`).close.filter((e) => !entries.some((x) => x.id === e.id)).slice(0, 20)
      : [];
  const closeStart = close.length ? entries.length : -1;
  const shown = [...entries, ...close];
  const query = new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && k !== "limit") as [string, string][]).toString();

  return (
    <Card id="activity" className="scroll-mt-28 p-5" role="region" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        Activity log
        <InfoTip text="Sign-ins, people and roles, settings, deletes and archives, and runs opened or closed. Test results, cases run and bugs filed are never logged, and there are no per-person counts. Nobody, including admins, can edit or delete entries." />
      </h2>
      <AutoFilterForm className="mt-3 flex flex-wrap gap-2">
        <Input name="q" defaultValue={filters.q} placeholder="Search names, cases, runs…" aria-label="Search the activity log" className="h-8 min-w-40 flex-1" />
        <Select name="who" defaultValue={filters.who ?? ""} aria-label="Who" className="h-8 w-auto">
          <option value="">Anyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? p.email}
            </option>
          ))}
        </Select>
        <Select name="kind" defaultValue={filters.kind ?? ""} aria-label="What" className="h-8 w-auto">
          <option value="">All activity</option>
          {Object.entries(ACTIVITY_KINDS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        {umbrellas.length > 0 && (
          <Select name="umbrella" defaultValue={filters.umbrella ?? ""} aria-label="Umbrella" className="h-8 w-auto">
            <option value="">All umbrellas</option>
            {umbrellas.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
        <Select name="days" defaultValue={filters.days ?? "30"} aria-label="When" className="h-8 w-auto">
          {DAY_CHOICES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <a href={`/workspace/activity/export${query ? `?${query}` : ""}`} className={buttonClass("secondary", "sm") + " h-8"}>
          Export CSV
        </a>
      </AutoFilterForm>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10.5px] tracking-wide text-slate-500 uppercase">
              <th className="py-1.5 pr-2 font-semibold">When</th>
              <th className="py-1.5 pr-2 font-semibold">Who</th>
              <th className="py-1.5 pr-2 font-semibold">What</th>
              <th className="py-1.5 pr-2 font-semibold">Where</th>
              <th className="py-1.5 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <Fragment key={e.id}>
              {i === closeStart && (
                <tr>
                  <td colSpan={5} className="py-1">
                    {closeStart === 0 && <p className="pb-1 text-xs text-slate-500">No exact matches.</p>}
                    <CloseMatchesLabel className="px-0" />
                  </td>
                </tr>
              )}
              <tr className="border-b border-slate-100 align-top">
                <td className="py-1.5 pr-2 whitespace-nowrap text-slate-500 tabular-nums">
                  {shortDate(e.at, spelling, zone)}, {clockTime(e.at, spelling, zone)}
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap text-slate-800">{e.actorLabel}</td>
                <td className="py-1.5 pr-2 text-slate-800">
                  <Badge tone={TONE[e.kind] ?? "gray"} className="mr-1.5">
                    {ACTIVITY_KINDS[e.kind as keyof typeof ACTIVITY_KINDS] ?? e.kind}
                  </Badge>
                  {e.action}
                </td>
                <td className="py-1.5 pr-2 text-slate-600">{e.where}</td>
                <td className="py-1.5 text-slate-500">
                  {e.detail}
                  {e.ip && e.kind === "signin" && <span className="text-slate-400">{e.detail ? " · " : ""}From {e.ip}</span>}
                </td>
              </tr>
              </Fragment>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  Nothing logged for these filters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <ActivityKeep days={ws?.activityKeepDays ?? 365} choices={KEEP_CHOICES.map(([d, l]) => [d, l])} />
        <span className="flex-1" />
        <span>
          Showing {entries.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
        </span>
        {entries.length < total && (
          <Link href={`/workspace?${query ? `${query}&` : ""}limit=${take + 200}#activity`} scroll={false} className="font-medium text-accent-700 hover:underline">
            Show more
          </Link>
        )}
      </div>
    </Card>
  );
}

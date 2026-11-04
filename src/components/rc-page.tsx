import { RcStatusView } from "@/components/rc-status";
import { SentryCard } from "@/components/sentry-card";
import { sentryConnected } from "@/lib/sentry-config";
import { EmptyState } from "@/components/ui";
import { pickFor, readPrefs, releaseKey } from "@/lib/rc-status";
import { listReleases, rcStatus, type RcScope } from "@/server/rc-status";
import { attachedWrapUps, countedBashWrapUps, rcWrapKey, releaseStart, wrapPickOf } from "@/lib/wrap-ups";
import { AttachWrapUps } from "@/components/wrap-ups";
import type { WrapScope } from "@/server/wrap-ups";

type Viewer = { id: string; isAdmin: boolean; rcReport: unknown; name?: string | null; email?: string };

/** The Release status report for a page: everything the viewer can see, one umbrella's projects, or one project's. */
export async function RcReport({
  user,
  want,
  base,
  scope,
  scopeNote,
  exportUrl,
  cycle = false,
  wrapScope,
}: {
  user: Viewer;
  want?: string;
  base: string;
  scope?: RcScope;
  scopeNote?: string;
  /** The Reports export route, for the Export menu. */
  exportUrl?: string;
  cycle?: boolean;
  /** Attach wrap-ups: the umbrella or test cycle whose bashes and exploring can be attached. */
  wrapScope?: WrapScope;
}) {
  const releases = await listReleases(user, scope);
  const prefs = readPrefs(user.rcReport);
  const wanted = want ?? prefs.release;
  const release = releases.find((r) => wanted && releaseKey(r) === releaseKey(wanted)) ?? releases[0];
  if (!release)
    return (
      <EmptyState title="No releases yet">
        Release status is for testing a release candidate. Runs show up here once they have a release: set it when you create a run, or later from the run&apos;s Edit
        button. All other testing is on Test runs.
      </EmptyState>
    );
  // Bug bashes join a report as wrap-ups now, not as a column.
  const pick = { ...pickFor(prefs, release), bashes: false };
  const status = await rcStatus(user, release, pick, scope);
  // Sentry: how the release's build is doing, when the scope's test cycles have Sentry.
  const sentryFor = scope ? (await Promise.all(scope.projectIds.map(async (id) => ((await sentryConnected(id)) ? id : null)))).find(Boolean) : null;
  const runIds = status.columns.flatMap((c) => c.runIds);
  const wrapKey = rcWrapKey(base, release);
  const wrapPick = wrapPickOf(user.rcReport, wrapKey);
  const [attached, counted] = await Promise.all([
    scope && wrapScope ? attachedWrapUps(scope.projectIds, wrapPick, wrapPick.auto ? await releaseStart(scope.projectIds, release) : null) : [],
    // Bashes counted toward this release by name join by themselves (ver_152).
    scope ? countedBashWrapUps(scope.projectIds, release) : [],
  ]);
  const wrapUps = [...counted, ...attached.filter((w) => !counted.some((c) => c.id === w.id))].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
    <RcStatusView
      releases={releases}
      release={release}
      pick={pick}
      base={base}
      scopeNote={scopeNote}
      exportTo={exportUrl ? { url: `${exportUrl}?release=${encodeURIComponent(release)}`, cycle, preparedBy: user.name ?? user.email ?? "" } : undefined}
      wrapUps={wrapUps}
      attach={wrapScope && <AttachWrapUps scope={wrapScope} prefKey={wrapKey} pick={wrapPick} count={wrapUps.length} release={release} />}
      {...status}
    />
    {sentryFor && runIds.length > 0 && (
      <div className="mt-5">
        <SentryCard projectId={sentryFor} runIds={runIds} />
      </div>
    )}
    </>
  );
}

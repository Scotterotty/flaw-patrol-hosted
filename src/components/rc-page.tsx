import { RcStatusView } from "@/components/rc-status";
import { EmptyState } from "@/components/ui";
import { pickFor, readPrefs, releaseKey } from "@/lib/rc-status";
import { listReleases, rcStatus, type RcScope } from "@/server/rc-status";

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
}: {
  user: Viewer;
  want?: string;
  base: string;
  scope?: RcScope;
  scopeNote?: string;
  /** The Reports export route, for the Export menu (ver_91). */
  exportUrl?: string;
  cycle?: boolean;
}) {
  const releases = await listReleases(user, scope);
  const prefs = readPrefs(user.rcReport);
  const wanted = want ?? prefs.release;
  const release = releases.find((r) => wanted && releaseKey(r) === releaseKey(wanted)) ?? releases[0];
  if (!release)
    return (
      <EmptyState title="No releases yet">
        Release status is for testing a release candidate. Runs show up here once they have a release: set it when you start a run, or later from the run&apos;s Edit
        button. All other testing is on Test runs.
      </EmptyState>
    );
  const pick = pickFor(prefs, release);
  return (
    <RcStatusView
      releases={releases}
      release={release}
      pick={pick}
      base={base}
      scopeNote={scopeNote}
      exportTo={exportUrl ? { url: `${exportUrl}?release=${encodeURIComponent(release)}`, cycle, preparedBy: user.name ?? user.email ?? "" } : undefined}
      {...await rcStatus(user, release, pick, scope)}
    />
  );
}

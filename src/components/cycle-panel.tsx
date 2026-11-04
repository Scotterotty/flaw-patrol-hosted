import type { ReactNode } from "react";
import { ProjectDetailsForm } from "./members";
import { CycleDigest } from "./digest-card";
import { CycleSlack } from "./slack-card";
import { KeepCurrentSwitch, KeepSeparateSwitch } from "./umbrella-ui";
import { Card } from "./ui";

/**
 * What opens under a test cycle's row in umbrella Settings → Test cycles:
 * the few things a test cycle can set for itself. Everything else is the umbrella's.
 * Each part is the same form the old test cycle settings page had.
 */
export function CyclePanel({
  anchor,
  umbrella,
  details,
  team,
  jira,
  slack,
  digest,
  restore,
  pin,
}: {
  restore?: ReactNode;
  /** 📌 Keep in Current; null for archived test cycles. */
  pin?: { projectId: string; on: boolean; platform: string; canChange: boolean } | null;
  anchor: string;
  umbrella: string;
  details: { projectId: string; name: string; description: string } | null;
  team: { projectId: string; separate: boolean; canSeparate: boolean; members: ReactNode | null; fromUmbrella: number; seesMembers: boolean; ask: ReactNode | null };
  jira: { canManage: boolean; own: boolean; summary: string; form: ReactNode };
  slack: Parameters<typeof CycleSlack>[0];
  digest?: Parameters<typeof CycleDigest>[0];
}) {
  return (
    <div className="space-y-4">
      {restore}
      {details && (
        <div id={`details-${anchor}`} tabIndex={-1} className="outline-none">
          <ProjectDetailsForm projectId={details.projectId} name={details.name} description={details.description} />
        </div>
      )}
      {pin && (
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Current</h2>
          <KeepCurrentSwitch projectId={pin.projectId} on={pin.on} platform={pin.platform} disabled={!pin.canChange} />
        </Card>
      )}
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-slate-800">Team</h2>
        <KeepSeparateSwitch projectId={team.projectId} on={team.separate} umbrella={umbrella} disabled={!team.canSeparate} />
        {/* Who's on a team is for Admins only (ver_168); everyone else gets who to ask. */}
        {!team.separate && team.seesMembers && <p className="text-xs text-slate-500">{team.fromUmbrella ? `${team.fromUmbrella} people from ${umbrella}'s team. Add or remove them in Members above.` : `Add people in Members above.`}</p>}
        {!team.separate && !team.seesMembers && <p className="text-xs text-slate-500">Same people as {umbrella}.</p>}
        {team.separate && !team.seesMembers && team.ask}
      </Card>
      {team.separate && team.members}
      {jira.canManage ? (
        jira.own ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{jira.summary}</p>
            {jira.form}
          </div>
        ) : (
          <Card id={`jira-${anchor}`} className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Jira</h2>
            <p className="text-sm text-slate-700">{jira.summary}</p>
            <details>
              <summary className="cursor-pointer text-sm text-accent-700 hover:underline">Use a different Jira for this test cycle only</summary>
              <div className="mt-3">{jira.form}</div>
            </details>
          </Card>
        )
      ) : (
        <Card className="space-y-1 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Jira</h2>
          <p className="text-sm text-slate-700">{jira.summary}</p>
        </Card>
      )}
      <CycleSlack {...slack} />
      {digest && <CycleDigest {...digest} />}
    </div>
  );
}

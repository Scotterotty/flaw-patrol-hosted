import { badgeOf } from "@/lib/game";
import { ArchiveCard } from "@/components/archive-project";
import { archiveCardData } from "@/lib/archive-card";
import { parseFoundIn } from "@/lib/found-in";
import { BugTemplatePanel, JiraSettings } from "@/components/jira-settings";
import { parseSeverityConfig } from "@/lib/severity";
import { CycleSlack, SlackCard } from "@/components/slack-card";
import { slackChannelsOf } from "@/lib/slack";
import { CycleDigest, DigestCard } from "@/components/digest-card";
import { digestCardData } from "@/lib/digest-data";
import { digestSummary, parseDigestSettings } from "@/lib/digest-settings";
import { parseStoriesConfig } from "@/lib/stories-config";
import Link from "next/link";
import { MembersPanel, ProjectDetailsForm } from "@/components/members";
import { Card, PageHeader } from "@/components/ui";
import { parseTemplateSettings } from "@/lib/bug-template";
import { bugTemplateView } from "@/lib/shared-template-data";
import { canOpen } from "@/lib/crypto";
import { db } from "@/lib/db";
import { adminsOf, joinRequestRows } from "@/lib/link-access-server";
import { AskAdminLine } from "@/components/ask-admin";
import { memberInviteInfo } from "@/lib/invites";
import { can } from "@/lib/permissions";
import { RolesCard } from "@/components/roles-card";
import { SentryPanel } from "@/components/sentry-settings";
import { RolesNudge } from "@/components/roles-nudge";
import { projectAccess } from "@/lib/session";
import { APP_VERSION } from "@/lib/version";
import { KeepSeparateSwitch } from "@/components/umbrella-ui";
import { UmbrellaIcon } from "@/components/umbrella-nav";
import { HashRedirect } from "@/components/settings-row";
import { CycleSettingsRedirect } from "@/components/cycle-settings";
import { ClientsSettings } from "@/components/clients-settings";
import { OtherSettings } from "@/components/other-settings";
import { loadUmbrella } from "@/lib/umbrella";
import { BugTemplatesSettings } from "@/components/bug-templates";
import { loadBugTemplates } from "@/lib/bug-templates-data";

export const metadata = { title: "Test cycle settings" };

export default async function SettingsPage({ params }: { params: Promise<{ key: string }> }) {
  const { project, user, who } = await projectAccess((await params).key);
  // The umbrella's own library project has no settings page of its own: its team and Jira are on the umbrella's.
  const hubOf = await db.projectGroup.findUnique({ where: { hubProjectId: project.id }, select: { id: true, name: true } });
  if (hubOf) return <HashRedirect to={`/g/${hubOf.id}/settings`} />;
  // Since ver_117 a test cycle under an umbrella is set in the umbrella's Settings → Test cycles, on its own row.
  // Someone on a separate test cycle's team but not the umbrella's still gets this page.
  if (project.groupId && (await loadUmbrella(project.groupId, user))) return <CycleSettingsRedirect groupId={project.groupId} cycleKey={project.key} />;
  // Who's on the team is for Admins only (ver_168): everyone else gets the Admins to ask instead.
  const canMembers = can(who, "members:manage");
  const askAdmins = canMembers ? [] : await adminsOf(project.id);
  const members = await db.projectMember.findMany({
    where: { projectId: project.id, ...(canMembers ? {} : { userId: { in: [] } }) },
    include: { user: true },
    orderBy: [{ role: "asc" }, { user: { email: "asc" } }],
  });
  const invites = await memberInviteInfo(members.map((m) => m.userId));
  const requests = can(who, "members:manage") ? await joinRequestRows(project.id) : [];
  const canManage = can(who, "project:manage");
  const canJira = can(who, "jira:manage");
  const sentryRow = await db.sentryConfig.findUnique({ where: { projectId: project.id } });
  const jiraRow = await db.jiraConfig.findUnique({
    where: { projectId: project.id },
    select: { siteUrl: true, email: true, jiraProjectKey: true, issueType: true, tokenEncrypted: true, bugTemplate: true, stories: true, severity: true, foundIn: true },
  });
  // Under an umbrella: where the library, Jira and team come from.
  const parent = project.groupId ? await db.projectGroup.findUnique({ where: { id: project.groupId }, include: { hub: { select: { id: true, key: true, jira: { select: { jiraProjectKey: true, siteUrl: true, bugTemplate: true, sharedTemplateId: true } } } } } }) : null;
  const umbrella = parent?.hub
    ? {
        id: parent.id,
        name: parent.name,
        hubKey: parent.hub.key,
        jiraKey: parent.hub.jira?.jiraProjectKey ?? null,
        site: parent.hub.jira?.siteUrl.replace(/^https?:\/\//, "") ?? null,
        template: parseTemplateSettings(parent.hub.jira?.bugTemplate).on || !!parent.hub.jira?.sharedTemplateId,
      }
    : null;
  const archive = await archiveCardData(user, parent?.hub ? parent.id : null, can(who, "cycle:archive") ? { id: project.id, name: project.name, archived: !!project.archivedAt && !project.archivedWithUmbrella } : null);
  const fromUmbrella = members.filter((m) => m.fromUmbrella).length;
  // Slack: a test cycle in an umbrella follows its channels (or picks); one outside an umbrella has its own card.
  const [slackOwn, slackUmbrella] = await Promise.all([slackChannelsOf({ projectId: project.id }), umbrella ? slackChannelsOf({ groupId: umbrella.id }) : []]);
  const templateView = await bugTemplateView(project.id, user.email);
  // Email digests: a test cycle outside an umbrella has its own card; one inside follows or chooses.
  const digest = await digestCardData(project.emailDigest, [project.id]);
  const umbrellaDigest = umbrella ? parseDigestSettings((await db.projectGroup.findUnique({ where: { id: umbrella.id }, select: { emailDigest: true } }))?.emailDigest) : null;
  // Bug templates: a test cycle outside an umbrella keeps its own list.
  const bugTemplates = umbrella ? null : await loadBugTemplates(project);
  const jira = jiraRow && { siteUrl: jiraRow.siteUrl, email: jiraRow.email, jiraProjectKey: jiraRow.jiraProjectKey, issueType: jiraRow.issueType, tokenReadable: canOpen(jiraRow.tokenEncrypted) };
  return (
    <div className="page page-settings space-y-5">
      <PageHeader title="Test cycle settings" subtitle={<>Test cycle key <code className="font-mono">{project.key}</code></>} />
      {umbrella && (
        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <UmbrellaIcon className="size-4 text-accent-600" />
            Part of {umbrella.name}
          </h2>
          <p className="text-sm text-slate-600">
            Runs here use cases and suites from the {umbrella.name} case library.{" "}
            <Link href={`/g/${umbrella.id}/settings`} className="font-medium text-accent-700 hover:underline">
              {umbrella.name} settings
            </Link>
          </p>
          <KeepSeparateSwitch projectId={project.id} on={project.keepMembersSeparate} umbrella={umbrella.name} disabled={!can(who, "project:separate")} />
          {canMembers && !project.keepMembersSeparate && fromUmbrella > 0 && <p className="text-xs text-slate-500">{fromUmbrella} of the members below come from {umbrella.name}&apos;s team and follow it.</p>}
        </Card>
      )}
      {canManage && <ProjectDetailsForm projectId={project.id} name={project.name} description={project.description} />}
      <Card id="clients" className="scroll-mt-20 space-y-3 p-5">
        <h2 className="text-sm font-semibold text-slate-800">Clients</h2>
        <ClientsSettings projectId={project.id} clients={project.clients} canChange={canManage} cycle={project.name} />
      </Card>
      {!canMembers && <AskAdminLine admins={askAdmins} />}
      {canMembers && <MembersPanel
        projectId={project.id}
        me={user.id}
        canManage={canMembers}
        canEmail={invites.canEmail}
        requests={requests}
        team={project.name}
        nudge={!project.groupId && !project.rolesChosenAt && <RolesNudge target={{ projectId: project.id }} href={`/p/${project.key}/settings#roles`} />}
                members={members.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, signedIn: !!m.user.lastLoginAt, hasPassword: !!m.user.passwordSetAt, avatarAt: m.user.avatarAt, inviteSentAt: invites.sent.get(m.userId) ?? null, inviteUntil: invites.until.get(m.userId) ?? null, ...badgeOf(m.user) }))}
      />}
      {/* Under an umbrella with no Jira of its own, one line says whose Jira it uses; the full form is the override. */}
      {canJira && umbrella && !jiraRow ? (
        <Card id="jira" className="scroll-mt-20 space-y-3 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Jira</h2>
          <p className="text-sm text-slate-700">
            {umbrella.jiraKey ? (
              <>
                ✓ Using {umbrella.name}&apos;s Jira: {umbrella.site} · Jira project {umbrella.jiraKey}
                {umbrella.template ? `, with ${umbrella.name}'s bug template` : ""}.{" "}
              </>
            ) : (
              <>{umbrella.name} hasn&apos;t connected Jira yet. Connect it once there and every test cycle under it uses it. </>
            )}
            <Link href={`/g/${umbrella.id}/settings`} className="font-medium text-accent-700 hover:underline">
              Open {umbrella.name} settings
            </Link>
          </p>
          <details>
            <summary className="cursor-pointer text-sm text-accent-700 hover:underline">Use a different Jira for this test cycle only</summary>
            <div className="mt-3">
              <JiraSettings projectId={project.id} current={null} template={parseTemplateSettings(null)} />
            </div>
          </details>
        </Card>
      ) : (
        canJira && (
          <>
            {umbrella && jiraRow && (
              <p className="text-sm text-slate-600">
                This test cycle files bugs into its own Jira project, {jiraRow.jiraProjectKey}. Disconnect it below to use {umbrella.name}&apos;s instead.
              </p>
            )}
            <JiraSettings projectId={project.id} current={jira} noTemplate={!!bugTemplates} template={templateView.template} shared={templateView.shared} stories={parseStoriesConfig(jiraRow?.stories)} severity={parseSeverityConfig(jiraRow?.severity)} foundIn={parseFoundIn(jiraRow?.foundIn)} />
          </>
        )
      )}
      {bugTemplates && (
        <Card id="bug-templates" className="scroll-mt-20 space-y-3 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Bug templates</h2>
          <BugTemplatesSettings
            projectId={project.id}
            current={bugTemplates.current}
            templates={bugTemplates.templates}
            defaultId={bugTemplates.defaultId}
            canEdit={can(who, "bugtemplate:edit")}
            canDelete={can(who, "bugtemplate:delete")}
            jiraConnected={!!jiraRow}
            currentPanel={canJira && jira ? <BugTemplatePanel projectId={project.id} template={templateView.template} jiraProjectKey={jira.jiraProjectKey} tokenReadable={jira.tokenReadable} shared={templateView.shared} /> : null}
          />
        </Card>
      )}
      {canMembers &&
        (umbrella ? (
          <Card id="roles" className="space-y-1 p-5">
            <h2 className="text-sm font-semibold text-slate-800">What can they do</h2>
            <p className="text-sm text-slate-600">
              This test cycle follows {umbrella.name}: {{ everyone: "everyone can use every feature except archive, delete and connections", tighter: "the Tighter preset", custom: "custom roles" }[who.rules?.preset ?? "everyone"]}.{" "}
              <Link href={`/g/${umbrella.id}/settings#roles`} className="font-medium text-accent-700 hover:underline">
                Change in {umbrella.name} settings
              </Link>
            </p>
          </Card>
        ) : (
          <RolesCard target={{ projectId: project.id }} rules={who.rules ?? null} appliesTo={`${project.name} and its runs`} />
        ))}
      {umbrella ? (
        <CycleSlack
          projectId={project.id}
          mode={(["umbrella", "choose", "off"].includes(project.slackMode) ? project.slackMode : "umbrella") as "umbrella" | "choose" | "off"}
          picked={project.slackChannelIds}
          umbrella={umbrella.name}
          umbrellaChannels={slackUmbrella}
          own={slackOwn}
          canManage={canJira}
          settingsHref={`/g/${umbrella.id}/settings#slack`}
        />
      ) : (
        <SlackCard target={{ projectId: project.id }} channels={slackOwn} canManage={canJira} tip="Post to Slack when something needs the team's eyes. Each channel picks its own alerts." />
      )}
      {umbrella && umbrellaDigest ? (
        <CycleDigest
          projectId={project.id}
          mode={(["umbrella", "choose", "off"].includes(project.emailDigestMode) ? project.emailDigestMode : "umbrella") as "umbrella" | "choose" | "off"}
          umbrella={umbrella.name}
          umbrellaSummary={digestSummary(umbrellaDigest, umbrellaDigest.groupIds.map((id) => digest.groups.find((g) => g.id === id)?.name ?? "").filter(Boolean))}
          canManage={canJira}
          own={digest}
          isAdmin={user.isAdmin}
          team={project.name}
        />
      ) : (
        <DigestCard target={{ projectId: project.id }} data={digest} canManage={canJira} team={project.name} isAdmin={user.isAdmin} />
      )}
      {/* Sentry: test cycles in an umbrella use the umbrella's connection. */}
      {!umbrella && (
        <Card id="sentry" className="scroll-mt-20 p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Sentry</h2>
          <p className="mb-3 text-xs text-slate-500">See the app&apos;s errors next to failed steps and add them to bugs. Flaw Patrol only reads from Sentry.</p>
          <SentryPanel
            projectId={project.id}
            canManage={canJira}
            fields={[]}
            saved={sentryRow && { baseUrl: sentryRow.baseUrl, org: sentryRow.org, connectedAs: sentryRow.connectedAs, projects: Array.isArray(sentryRow.projects) ? (sentryRow.projects as { id: string; slug: string }[]) : [], environment: sentryRow.environment, buildField: sentryRow.buildField, onlyTester: sentryRow.onlyTester, tokenReadable: canOpen(sentryRow.tokenEncrypted) }}
          />
        </Card>
      )}
      {/* One Archive… card: this test cycle, others in its umbrella, or the whole umbrella. */}
      {archive && <ArchiveCard data={archive} />}
      <OtherSettings admin={user.isAdmin} />
      <p className="pt-2 text-center text-xs text-slate-400">
        Flaw Patrol version <span className="font-mono">{APP_VERSION}</span>
      </p>
    </div>
  );
}

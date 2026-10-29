import Link from "next/link";
import { RunFieldsPanel } from "@/components/run-fields-settings";
import { RunKindsPanel } from "@/components/run-kinds-settings";
import { parseRunKinds } from "@/lib/run-kinds";
import { parseRunFields } from "@/lib/run-fields";
import { DEFAULT_STORIES, parseStoriesConfig } from "@/lib/stories-config";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EditGroupButton, type GroupChoice } from "@/components/group-dialogs";
import { buttonClass, Card, InfoTip, PageHeader } from "@/components/ui";
import { AddUmbrellaProject } from "@/components/umbrella-ui";
import { ArchiveCard } from "@/components/archive-project";
import { RolesCard } from "@/components/roles-card";
import { SentryPanel } from "@/components/sentry-settings";
import { CrownNamesPanel } from "@/components/crown-names";
import { RolesNudge } from "@/components/roles-nudge";
import { SlackCard } from "@/components/slack-card";
import { RegressionPanel } from "@/components/regression-settings";
import { COMPARE_MODES, parseRegressionSettings } from "@/lib/regression";
import { ExpandRow, SettingsRows } from "@/components/settings-row";
import { AutomationFilesPanel } from "@/components/automation-storage";
import { mb, parseFileSettings } from "@/lib/automation-files";
import { storageUsage } from "@/lib/automation-storage";
import { BugTemplatePanel, JiraSettings, StoriesPanel } from "@/components/jira-settings";
import { parseSeverityConfig } from "@/lib/severity";
import { MembersPanel } from "@/components/members";
import { CiUploadsPanel } from "@/components/ci-uploads";
import { GitHubPanel, PullFromGitHubButton } from "@/components/github";
import { relativeTime } from "@/lib/format";
import { mySpelling } from "@/lib/session";
import { badgeOf } from "@/lib/game";
import { canOpen } from "@/lib/crypto";
import { slackChannelsOf } from "@/lib/slack";
import { archiveCardData } from "@/lib/archive-card";
import { UmbrellaIcon } from "@/components/umbrella-nav";
import { parseTemplateSettings, templateKind } from "@/lib/bug-template";
import { db } from "@/lib/db";
import { memberInviteInfo } from "@/lib/invites";
import { canManageGroups } from "@/lib/groups";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { bugTemplateView } from "@/lib/shared-template-data";
import { loadUmbrella, looseProjects, platformColor } from "@/lib/umbrella";

export const metadata = { title: "Settings" };

const projectsOfSentry = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is { id: string; slug: string } => !!p && typeof p.id === "string" && typeof p.slug === "string") : []);

/** What the umbrella sets once for all its projects, and which projects use their own instead. */
export default async function UmbrellaSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const name = u.group.name;
  // Jira, bug template, stories and members live on the umbrella's hidden library project; they open in place here.
  const [jira, members, ownJira] = await Promise.all([
    db.jiraConfig.findUnique({ where: { projectId: u.hub.id } }),
    db.projectMember.findMany({ where: { projectId: u.hub.id }, include: { user: true }, orderBy: [{ role: "asc" }, { user: { email: "asc" } }] }),
    db.jiraConfig.findMany({ where: { projectId: { in: u.projects.map((p) => p.id) } }, select: { projectId: true, jiraProjectKey: true, bugTemplate: true } }),
  ]);
  const { template, shared } = await bugTemplateView(u.hub.id, user.email);
  const sentry = await db.sentryConfig.findUnique({ where: { projectId: u.hub.id } });
  const leads = members.filter((m) => m.role === "LEAD" || m.role === "ADMIN").length;
  const invites = await memberInviteInfo(members.map((m) => m.userId));
  const manage = can(u.who, "jira:manage");
  const archive = await archiveCardData(user, u.group.id, null);
  const runFields = parseRunFields(u.group.runFields);
  const runKinds = parseRunKinds(u.group.runKinds);
  const kindSuites = await db.testSuite.findMany({ where: { projectId: u.hub.id, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const slack = await slackChannelsOf({ groupId: u.group.id });
  const reg = parseRegressionSettings(u.group.regression);
  const fileSettings = parseFileSettings(u.group.automationFiles);
  const usage = await storageUsage(u.group.id);
  const slackPaused = slack.length > 0 && slack.every((c) => c.paused);
  // GitHub (ver_85): connected repos, and the newest run pulled from each.
  const spelling = await mySpelling();
  const repos = await db.gitHubRepo.findMany({
    where: { groupId: u.group.id },
    orderBy: { createdAt: "asc" },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1, select: { githubRunNo: true, createdAt: true } } },
  });
  const canPull = can(u.who, "run:import") && !u.group.archivedAt;
  const pullable = repos.filter((r) => r.workflowId).map((r) => ({ id: r.id, fullName: r.fullName, workflowName: r.workflowName }));
  const githubText = repos.length
    ? repos
        .map((r) =>
          [r.fullName, r.workflowName ? `workflow ${r.workflowName}` : "Setup not finished: pick which workflow's test results to pull", r.runs[0] ? `last pulled GitHub run ${r.runs[0].githubRunNo}, ${relativeTime(r.runs[0].createdAt, spelling)}` : "nothing pulled yet"].join(" · "),
        )
        .join("; ")
    : "Bring in test results from a GitHub repo's workflow runs.";
  // Only once a repo is connected and set up (ver_94): before that there is nothing to pull.
  const pullButton = canPull && pullable.length > 0 ? <PullFromGitHubButton groupId={u.group.id} repos={pullable} size="sm" variant="primary" /> : null;
  const githubStatus = (
    <>
      {repos.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">✓ Connected</span>}
      {pullButton}
    </>
  );
  // CI uploads (ver_91): tokens a pipeline sends with its results file.
  const ciTokens = await db.ciToken.findMany({ where: { groupId: u.group.id }, orderBy: { createdAt: "asc" } });
  const ciText = ciTokens.length
    ? `${ciTokens.length} ${ciTokens.length === 1 ? "token" : "tokens"} · ${ciTokens.some((t) => t.lastUsedAt) ? `last upload ${relativeTime(new Date(Math.max(...ciTokens.map((t) => t.lastUsedAt?.getTime() ?? 0))), spelling)}` : "no uploads yet"}`
    : "Let your pipeline send its results file after every build, with no one pressing Upload.";
  const own = new Map(ownJira.map((j) => [j.projectId, { key: j.jiraProjectKey, kind: templateKind(parseTemplateSettings(j.bugTemplate)) }]));
  const hubKind = templateKind(template);
  const hubImported = hubKind !== "plain";
  const kindLabel = (k: "plain" | "imported" | "detailed") => (k === "imported" ? "Imported" : k === "detailed" ? "OKO layout" : "Plain layout");
  const whose = name.endsWith("s") ? `${name}'` : `${name}'s`;
  const site = jira?.siteUrl.replace(/^https?:\/\//, "");
  const templateText = !jira
    ? "Plain layout. Connect Jira first to import a template."
    : shared.current
      ? `${shared.current.name} (shared)${template.clientTag ? ` · tag [${template.clientTag}]` : ""}`
      : hubKind === "imported"
      ? `Imported from ${template.imported!.from} · ${template.imported!.sections.filter((x) => x.source !== "empty").length} sections, ${template.imported!.fields.filter((f) => f.source !== "empty").length} fields`
      : hubKind === "detailed"
        ? `OKO bug layout (from OB-5292)${template.clientTag ? ` · tag [${template.clientTag}]` : ""}`
        : "Plain layout";
  const storiesText = !jira
    ? "Connect Jira first to link cases to Jira requirements."
    : (() => {
        const st = parseStoriesConfig(jira.stories) ?? DEFAULT_STORIES;
        return `${st.project === "*" ? "Any Jira project" : `Jira project ${st.project || jira.jiraProjectKey}`} · ${st.types.join(", ")}${st.rollUp ? " · Epics count their child issues" : ""} · bug box ${st.linkBugs ? "links bugs to requirements" : "doesn't link bugs"} by default`;
      })();

  let choices: GroupChoice[] = [];
  const groupManager = await canManageGroups(user);
  if (groupManager) {
    const visible = await db.project.findMany({
      where: { hubOf: null, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) },
      include: { members: { where: { userId: user.id } }, group: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    choices = visible.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      archived: p.archivedAt !== null,
      groupId: p.groupId,
      groupName: p.group?.name ?? null,
      canMove: user.isAdmin || can(p.members[0]?.role ?? null, "project:group"),
    }));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${name} settings`}
        subtitle={`Shared by every test cycle under ${name}`}
        actions={
          groupManager ? <EditGroupButton group={u.group} choices={choices} label="Name and test cycles" /> : undefined
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <Card>
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Set once for {name}</h2>
          <ul className="divide-y divide-slate-100">
            <SettingsRows>
            {manage ? (
              <ExpandRow
                id="jira"
                hashes={["jira"]}
                title="Jira connection"
                text={jira ? `${site} · Jira project ${jira.jiraProjectKey} · token from ${jira.email}` : `Not connected. Connect it once here and every ${name} test cycle files bugs into it.`}
                label={jira ? "Change" : "Connect"}
                status={jira ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Connected</span> : undefined}
              >
                <JiraSettings
                  projectId={u.hub.id}
                  current={jira && { siteUrl: jira.siteUrl, email: jira.email, jiraProjectKey: jira.jiraProjectKey, issueType: jira.issueType, tokenReadable: canOpen(jira.tokenEncrypted) }}
                  template={template}
                  connectionOnly
                  severity={parseSeverityConfig(jira?.severity)}
                />
              </ExpandRow>
            ) : (
              <Row
                title="Jira connection"
                text={jira ? `${site} · Jira project ${jira.jiraProjectKey}` : `Not connected yet.`}
                action={jira ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Connected</span> : null}
              />
            )}
            {manage && jira ? (
              <ExpandRow
                id="template"
                hashes={["template", "import-template"]}
                title="Bug template"
                text={templateText}
                label={hubKind === "plain" ? "Import…" : "Change"}
                openHash={hubKind === "plain" ? "import-template" : "template"}
                buttonVariant={hubKind === "plain" ? "primary" : undefined}
                buttonTitle={
                  hubKind === "plain"
                    ? `Opens ${whose} bug template with Import a template from Jira already picked.`
                    : hubKind === "imported"
                      ? `Opens ${whose} bug template to import a different bug, edit the fields, or go back to the plain layout.`
                      : `Opens ${whose} bug template to pick a different layout or import one from Jira.`
                }
              >
                <BugTemplatePanel projectId={u.hub.id} template={template} jiraProjectKey={jira.jiraProjectKey} tokenReadable={canOpen(jira.tokenEncrypted)} shared={shared} />
              </ExpandRow>
            ) : (
              <Row
                title="Bug template"
                text={templateText}
                action={
                  !manage ? (
                    <span className="text-sm text-slate-500">{kindLabel(hubKind)}</span>
                  ) : (
                    <span
                      tabIndex={0}
                      aria-disabled="true"
                      title={`Import reads the layout from an example bug in Jira, so ${name} needs Jira connected first. Connect it on the row above.`}
                      className={`${buttonClass(undefined, "sm")} cursor-help opacity-55`}
                    >
                      Import…
                    </span>
                  )
                }
              />
            )}
            {manage && jira ? (
              <ExpandRow id="stories" hashes={["stories"]} title="Requirements" text={storiesText} label="Change">
                <StoriesPanel projectId={u.hub.id} stories={parseStoriesConfig(jira.stories)} bugProject={jira.jiraProjectKey} />
              </ExpandRow>
            ) : (
              <Row title="Requirements" text={storiesText} />
            )}
            <ExpandRow
              id="run-fields"
              hashes={["run-fields"]}
              title="Run fields"
              text={runFields.length ? `Release, Build, Environment and ${runFields.map((f) => f.name).join(", ")}` : "Release, Build and Environment. Add your own, like a firmware or API version."}
              label={can(u.who, "umbrella:fields") ? "Change" : "View"}
            >
              <RunFieldsPanel groupId={u.group.id} umbrella={name} fields={runFields} canEdit={can(u.who, "umbrella:fields") && !u.group.archivedAt} />
            </ExpandRow>
            <ExpandRow
              id="run-kinds"
              hashes={["run-kinds"]}
              title="Run kinds"
              text={runKinds.filter((k) => !k.hidden).map((k) => k.name).join(", ")}
              label={can(u.who, "umbrella:fields") ? "Change" : "View"}
            >
              <RunKindsPanel groupId={u.group.id} umbrella={name} kinds={runKinds} suites={kindSuites} canEdit={can(u.who, "umbrella:fields") && !u.group.archivedAt} />
            </ExpandRow>
            <ExpandRow
              id="crowns"
              hashes={["crowns"]}
              title="Mini game crowns"
              text={u.platforms.length ? u.platforms.map((p) => p.crownName || `Ruler of ${p.name}`).join(", ") : "One crown per platform, for whoever runs the most there"}
              label={can(u.who, "umbrella:manage") ? "Change" : "View"}
            >
              <CrownNamesPanel groupId={u.group.id} platforms={u.platforms} canEdit={can(u.who, "umbrella:manage") && !u.group.archivedAt} />
            </ExpandRow>
            <ExpandRow
              id="slack"
              hashes={["slack"]}
              title="Slack alerts"
              text={slack.length ? `${slackPaused ? "Paused · " : ""}${slack.map((c) => c.name).join(", ")} · every test cycle follows unless changed` : "No channels yet. Post regressions, serious bugs and finished runs to Slack."}
              label={manage ? (slack.length ? "Manage" : "Set up") : "View"}
            >
              <SlackCard target={{ groupId: u.group.id }} channels={slack} canManage={manage} tip={`Post to Slack when something needs the team's eyes. Each channel picks its own alerts. Every ${name} test cycle follows these channels unless its own Settings change that.`} />
            </ExpandRow>
            <ExpandRow
              id="sentry"
              hashes={["sentry"]}
              title="Sentry"
              text={sentry ? `${sentry.org} · ${projectsOfSentry(sentry.projects).map((p) => p.slug).join(", ")}${sentry.environment ? ` · ${sentry.environment}` : ""}` : "Not connected. See the app's errors next to failed steps and add them to bugs."}
              label={manage ? (sentry ? "Change" : "Connect to Sentry") : "View"}
              buttonVariant={sentry || !manage ? undefined : "primary"}
            >
              <SentryPanel
                projectId={u.hub.id}
                canManage={manage}
                fields={runFields.map((f) => ({ id: f.id, name: f.name }))}
                saved={sentry && { baseUrl: sentry.baseUrl, org: sentry.org, connectedAs: sentry.connectedAs, projects: projectsOfSentry(sentry.projects), environment: sentry.environment, buildField: sentry.buildField, onlyTester: sentry.onlyTester, tokenReadable: canOpen(sentry.tokenEncrypted) }}
              />
            </ExpandRow>
            {manage ? (
              <ExpandRow
                id="github"
                hashes={["github"]}
                title="GitHub"
                text={githubText}
                label={repos.length ? "Change" : "Connect to GitHub"}
                buttonVariant={repos.length ? undefined : "primary"}
                status={githubStatus}
              >
                <GitHubPanel groupId={u.group.id} repos={repos.map((r) => ({ id: r.id, fullName: r.fullName, workflowId: r.workflowId, workflowName: r.workflowName, glob: r.resultsGlob, bringFiles: r.bringFiles }))} />
              </ExpandRow>
            ) : (
              <Row title="GitHub" text={githubText} action={githubStatus} />
            )}
            {manage ? (
              <ExpandRow id="ci-uploads" hashes={["ci-uploads"]} title="CI uploads" text={ciText} label={ciTokens.length ? "Manage" : "Set up"}>
                <CiUploadsPanel
                  groupId={u.group.id}
                  canManage={!u.group.archivedAt}
                  platforms={u.platforms.map((p) => p.name)}
                  tokens={ciTokens.map((t) => ({
                    id: t.id,
                    name: t.name,
                    last4: t.last4,
                    createdBy: t.createdBy,
                    created: relativeTime(t.createdAt, spelling),
                    lastUsed: t.lastUsedAt ? relativeTime(t.lastUsedAt, spelling) : null,
                  }))}
                />
              </ExpandRow>
            ) : (
              <Row title="CI uploads" text={ciText} />
            )}
            <ExpandRow
              id="automation-files"
              hashes={["automation-files"]}
              title="Screenshots, videos and replays"
              text={`From automation · keeping ${fileSettings.keep === "failed" ? "failed and flaky tests only" : "every test"}, up to ${fileSettings.maxMb} MB a file · using ${mb(usage.bytes)}`}
              label={can(u.who, "run:manage") ? "Change" : "View"}
            >
              <AutomationFilesPanel groupId={u.group.id} settings={fileSettings} usage={usage} canEdit={can(u.who, "run:manage") && !u.group.archivedAt} />
            </ExpandRow>
            <ExpandRow
              id="regression"
              hashes={["regression"]}
              title="Regression flag"
              text={reg.on ? `On · compares with ${COMPARE_MODES.find((m) => m.id === reg.compare)!.label.toLowerCase()} · Jira label ${reg.label}` : "Off. Tests that passed before and fail now aren't marked."}
              label={can(u.who, "run:manage") ? "Change" : "View"}
            >
              <RegressionPanel groupId={u.group.id} settings={reg} canEdit={can(u.who, "run:manage") && !u.group.archivedAt} />
            </ExpandRow>
            <ExpandRow
              id="members"
              hashes={["members"]}
              title="Members"
              text={`${members.length} ${members.length === 1 ? "person" : "people"} · ${leads} ${leads === 1 ? "lead or admin" : "leads and admins"} · everyone gets every ${name} test cycle unless it keeps members separate`}
              label={can(u.who, "members:manage") ? "Manage" : "View"}
            >
              <MembersPanel
                projectId={u.hub.id}
                me={user.id}
                canManage={can(u.who, "members:manage")}
                canEmail={invites.canEmail}
                nudge={!u.group.rolesChosenAt && <RolesNudge target={{ groupId: u.group.id }} href={`/g/${u.group.id}/settings#roles`} />}
                members={members.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, signedIn: !!m.user.lastLoginAt, hasPassword: !!m.user.passwordSetAt, avatarAt: m.user.avatarAt, inviteSentAt: invites.sent.get(m.userId) ?? null, ...badgeOf(m.user) }))}
              />
            </ExpandRow>
            </SettingsRows>
          </ul>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
              Where each test cycle files bugs
              <InfoTip text={`Test cycles use ${whose} Jira connection and bug template (set on the left) unless they have their own. Click a test cycle to open its Settings.`} />
            </h2>
            {can(u.who, "cycle:create") && !u.group.archivedAt && <AddUmbrellaProject groupId={u.group.id} umbrella={name} platforms={u.platforms.map((p) => p.name)} colors={u.platforms.map((p) => platformColor(u.platforms, p.name))} loose={await looseProjects(user)} label="Add test cycle" />}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2 font-semibold">Test cycle</th>
                <th className="px-4 py-2 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Jira project <InfoTip text="The Jira project this test cycle's bugs go into." />
                  </span>
                </th>
                <th className="px-4 py-2 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Bug template <InfoTip text="The layout new bugs use: a template imported from an example Jira bug, or the plain layout." />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {u.current.map((p) => {
                const mine = own.get(p.id);
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2">
                      <Link href={`/p/${p.key}/settings`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-800 hover:border-accent-500">
                        <span aria-hidden className="size-1.5 rounded-full" style={{ background: platformColor(u.platforms, p.platform) }} />
                        {p.name}
                      </Link>
                      {p.keepMembersSeparate && (
                        <span className="ml-1.5 cursor-help text-xs text-slate-500" title="Only people added to this test cycle can see it.">
                          Private team
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {mine ? (
                        <Chip tone="own" tip="This test cycle has its own Jira settings, so changes on the left don't affect it. Change them in its Settings.">
                          {mine.key} · its own
                        </Chip>
                      ) : jira ? (
                        <Chip tone="shared" tip={`Uses ${whose} Jira connection, set on the left.`}>
                          <UmbrellaIcon className="size-3" />
                          {jira.jiraProjectKey} · {whose}
                        </Chip>
                      ) : (
                        <Chip tone="off" tip={`${name} isn't connected to Jira yet, so bugs can't be sent to Jira. Connect it on the left.`}>
                          Not connected
                        </Chip>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {mine ? (
                        <Chip tone={mine.kind !== "plain" ? "own" : "off"} tip={mine.kind === "imported" ? "Uses the template imported in its own Jira settings." : mine.kind === "detailed" ? "Uses the OKO bug layout, picked in its own Jira settings." : "No template picked in its own Jira settings, so bugs use the plain layout."}>
                          {kindLabel(mine.kind)} · its own
                        </Chip>
                      ) : jira ? (
                        <Chip
                          tone={hubImported ? "shared" : "off"}
                          tip={hubKind === "imported" ? `Uses the template ${name} imported from Jira, set on the left.` : hubKind === "detailed" ? `Uses the OKO bug layout ${name} picked, set on the left.` : `${name} has no template imported, so bugs use the plain layout. Import one in ${whose} Jira settings on the left.`}
                        >
                          <UmbrellaIcon className="size-3" />
                          {kindLabel(hubKind)} · {whose}
                        </Chip>
                      ) : (
                        <Chip tone="off" tip="Available once Jira is connected.">
                          —
                        </Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
              {u.current.length === 0 && u.older.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      No test cycles yet
                      <InfoTip text="Each test cycle you add shows here with the Jira project and bug template its bugs use. Use Add test cycle above." />
                    </span>
                  </td>
                </tr>
              )}
              {u.older.length > 0 && (
                <tr>
                  <td className="px-4 py-2 text-slate-500">
                    <Link href={`/g/${u.group.id}/projects`} className="hover:underline">
                      + {u.older.length} older release {u.older.length === 1 ? "test cycle" : "test cycles"}
                    </Link>
                  </td>
                  <td colSpan={2} className="px-4 py-2 text-slate-500">
                    <Link href={`/g/${u.group.id}/projects`} className="hover:underline">
                      See the full list
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
      {can(u.who, "members:manage") && (
        <div className="mt-5">
          <RolesCard target={{ groupId: u.group.id }} rules={u.who.rules ?? null} appliesTo={`${name}, its Case library and all its test cycles`} />
        </div>
      )}
      {archive && (
        <div className="mt-5">
          <ArchiveCard data={archive} />
        </div>
      )}
    </div>
  );
}

function Row({ title, text, action, href }: { title: string; text: string; action?: ReactNode; href?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        {href?.startsWith("#") ? (
          <a href={href} className="block font-medium text-slate-900 hover:underline">
            {title}
          </a>
        ) : href ? (
          <Link href={href} className="block font-medium text-slate-900 hover:underline">
            {title}
          </Link>
        ) : (
          <span className="block font-medium text-slate-900">{title}</span>
        )}
        <span className="block text-sm text-slate-500">{text}</span>
      </span>
      {action}
    </li>
  );
}

/** A small chip in the bugs box, with what it means on hover. */
function Chip({ tone, tip, children }: { tone: "shared" | "own" | "off"; tip: string; children: ReactNode }) {
  const look = tone === "shared" ? "bg-accent-50 text-accent-700" : tone === "own" ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-600";
  return (
    <span tabIndex={0} title={tip} className={`inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${look}`}>
      {children}
    </span>
  );
}

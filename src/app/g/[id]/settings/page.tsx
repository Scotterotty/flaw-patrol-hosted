import Link from "next/link";
import { RunFieldsPanel } from "@/components/run-fields-settings";
import { RunKindsPanel } from "@/components/run-kinds-settings";
import { parseRunKinds } from "@/lib/run-kinds";
import { parseRunFields } from "@/lib/run-fields";
import { DEFAULT_STORIES, parseStoriesConfig } from "@/lib/stories-config";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EditGroupButton, type GroupChoice } from "@/components/group-dialogs";
import { buttonClass, Card, PageHeader } from "@/components/ui";
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
import { joinRequestRows } from "@/lib/link-access-server";
import { memberInviteInfo } from "@/lib/invites";
import { canManageGroups } from "@/lib/groups";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { bugTemplateView } from "@/lib/shared-template-data";
import { loadUmbrella, looseProjects, platformColor } from "@/lib/umbrella";
import { CycleSettingsTable, type CycleChip, type CycleRow } from "@/components/cycle-settings";
import { CyclePanel } from "@/components/cycle-panel";
import { OtherSettings } from "@/components/other-settings";
import { cycleHash } from "@/lib/cycle-hash";

export const metadata = { title: "Settings" };

const MODES = ["umbrella", "choose", "off"] as const;

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
    db.jiraConfig.findMany({
      where: { projectId: { in: u.projects.map((p) => p.id) } },
      select: { projectId: true, siteUrl: true, email: true, jiraProjectKey: true, issueType: true, tokenEncrypted: true, bugTemplate: true, stories: true, severity: true },
    }),
  ]);
  const { template, shared } = await bugTemplateView(u.hub.id, user.email);
  const sentry = await db.sentryConfig.findUnique({ where: { projectId: u.hub.id } });
  const leads = members.filter((m) => m.role === "LEAD" || m.role === "ADMIN").length;
  const invites = await memberInviteInfo(members.map((m) => m.userId));
  const requests = can(u.who, "members:manage") ? await joinRequestRows(u.hub.id) : [];
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
  const hubKind = templateKind(template);
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

  // Test cycles (ver_117): each one's row in the table, with what it can set for itself opening below.
  const cycles = [...u.current, ...u.older];
  const ids = cycles.map((p) => p.id);
  const [myRoles, cycleMembers, umbrellaChannelIds] = await Promise.all([
    db.projectMember.findMany({ where: { userId: user.id, projectId: { in: ids } }, select: { projectId: true, role: true } }),
    db.projectMember.findMany({ where: { projectId: { in: ids } }, include: { user: true }, orderBy: [{ role: "asc" }, { user: { email: "asc" } }] }),
    Promise.resolve(slack.map((c) => c.id)),
  ]);
  const roleIn = new Map(myRoles.map((m) => [m.projectId, m.role]));
  const cycleInvites = await memberInviteInfo([...new Set(cycleMembers.map((m) => m.userId))]);
  const jiraOf = new Map(ownJira.map((j) => [j.projectId, j]));
  const canArchiveCycles = !!archive?.umbrella?.cycles.length;
  const rows: CycleRow[] = await Promise.all(
    cycles.map(async (p) => {
      const cw = { role: user.isAdmin ? ("ADMIN" as const) : (roleIn.get(p.id) ?? null), rules: u.who.rules };
      const mine = jiraOf.get(p.id);
      const people = cycleMembers.filter((m) => m.projectId === p.id);
      const fromUmbrella = people.filter((m) => m.fromUmbrella).length;
      const mode = (MODES as readonly string[]).includes(p.slackMode) ? (p.slackMode as (typeof MODES)[number]) : "umbrella";
      const picked = p.slackChannelIds.filter((id) => umbrellaChannelIds.includes(id));
      const [ownChannels, view, requestsHere] = await Promise.all([
        slackChannelsOf({ projectId: p.id }),
        mine ? bugTemplateView(p.id, user.email) : Promise.resolve(null),
        p.keepMembersSeparate && can(cw, "members:manage") ? joinRequestRows(p.id) : Promise.resolve([]),
      ]);
      const team: CycleChip = p.keepMembersSeparate
        ? { tone: "own", text: `Its own · ${people.length} ${people.length === 1 ? "person" : "people"}`, tip: "Only the people added to this test cycle can see it." }
        : { tone: "same", text: "Same", tip: `Everyone on ${whose} team can see and test it.` };
      const jiraChip: CycleChip = mine
        ? { tone: "own", text: `Its own · ${mine.jiraProjectKey}`, tip: `Files bugs into its own Jira project, ${mine.jiraProjectKey}, with ${kindLabel(templateKind(parseTemplateSettings(mine.bugTemplate))).toLowerCase()}.` }
        : jira
          ? { tone: "same", text: jira.jiraProjectKey, tip: `Uses ${whose} Jira connection and bug template, set above.` }
          : { tone: "off", text: "Not connected", tip: `${name} isn't connected to Jira yet. Connect it above.` };
      const slackChip: CycleChip =
        mode === "off"
          ? { tone: "own", text: "Its own · Off", tip: "Nothing from this test cycle posts to Slack." }
          : mode === "choose"
            ? (() => {
                const n = picked.length + ownChannels.length;
                return { tone: "own" as const, text: `Its own · ${n} ${n === 1 ? "channel" : "channels"}`, tip: `Posts to ${[...slack.filter((c) => picked.includes(c.id)), ...ownChannels].map((c) => c.name).join(", ") || "no channels"}.` };
              })()
            : slack.length
              ? { tone: "same", text: "Same", tip: `Posts to ${slack.map((c) => c.name).join(", ")}, like ${name}.` }
              : { tone: "off", text: "No channels", tip: `${name} has no Slack channels yet. Add them in Slack alerts above.` };
      const jiraSummary = mine
        ? `${p.name} files bugs into its own Jira project, ${mine.jiraProjectKey}. Disconnect it below to use ${whose} instead.`
        : jira
          ? `✓ Using ${whose} Jira: ${site} · Jira project ${jira.jiraProjectKey}${hubKind !== "plain" ? `, with ${whose} bug template` : ""}.`
          : `${name} hasn't connected Jira yet. Connect it once above and every test cycle under it uses it.`;
      const archivedAlone = !!p.archivedAt && !p.archivedWithUmbrella;
      const panel = (
        <CyclePanel
          restore={archivedAlone && can(cw, "cycle:archive") ? <ArchiveCard data={{ current: { id: p.id, name: p.name, archived: true }, umbrella: null }} /> : null}
          anchor={cycleHash(p.key)}
          umbrella={name}
          details={can(cw, "project:manage") ? { projectId: p.id, name: p.name, description: p.description } : null}
          team={{
            projectId: p.id,
            separate: p.keepMembersSeparate,
            canSeparate: can(cw, "project:separate"),
            fromUmbrella,
            members: p.keepMembersSeparate ? (
              <MembersPanel
                projectId={p.id}
                me={user.id}
                canManage={can(cw, "members:manage")}
                canEmail={cycleInvites.canEmail}
                requests={requestsHere}
                team={p.name}
                members={people.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, signedIn: !!m.user.lastLoginAt, hasPassword: !!m.user.passwordSetAt, avatarAt: m.user.avatarAt, inviteSentAt: cycleInvites.sent.get(m.userId) ?? null, inviteUntil: cycleInvites.until.get(m.userId) ?? null, ...badgeOf(m.user) }))}
              />
            ) : null,
          }}
          jira={{
            canManage: can(cw, "jira:manage"),
            own: !!mine,
            summary: jiraSummary,
            form: mine ? (
              <JiraSettings
                projectId={p.id}
                current={{ siteUrl: mine.siteUrl, email: mine.email, jiraProjectKey: mine.jiraProjectKey, issueType: mine.issueType, tokenReadable: canOpen(mine.tokenEncrypted) }}
                template={view!.template}
                shared={view!.shared}
                stories={parseStoriesConfig(mine.stories)}
                severity={parseSeverityConfig(mine.severity)}
              />
            ) : (
              <JiraSettings projectId={p.id} current={null} template={parseTemplateSettings(null)} />
            ),
          }}
          slack={{
            projectId: p.id,
            mode,
            picked: p.slackChannelIds,
            umbrella: name,
            umbrellaChannels: slack,
            own: ownChannels,
            canManage: can(cw, "jira:manage"),
            settingsHref: `/g/${u.group.id}/settings#slack`,
          }}
        />
      );
      return { key: p.key, id: p.id, archived: archivedAlone, name: p.name.startsWith(`${name} `) ? p.name.slice(name.length + 1) : p.name, fullName: p.name, color: platformColor(u.platforms, p.platform), older: u.older.some((o) => o.id === p.id), team, jira: jiraChip, slack: slackChip, panel };
    }),
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Settings"
        subtitle={`${name} and its test cycles`}
        actions={
          groupManager ? <EditGroupButton group={u.group} choices={choices} label="Name and test cycles" /> : undefined
        }
      />
      <p className="mb-5 flex items-start gap-2 rounded-lg bg-accent-50 px-4 py-2.5 text-sm text-accent-700" data-testid="settings-scope">
        <UmbrellaIcon className="mt-0.5 size-4 flex-none" />
        <span>
          Changes here apply to <b>every test cycle in {name}</b>. The <b>Test cycles</b> table below shows any that are set differently.
        </span>
      </p>
      <div>
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
              text={`${requests.length ? `${requests.length} asking to join · ` : ""}${members.length} ${members.length === 1 ? "person" : "people"} · ${leads} ${leads === 1 ? "lead or admin" : "leads and admins"} · everyone gets every ${name} test cycle unless it keeps members separate`}
              label={can(u.who, "members:manage") ? "Manage" : "View"}
            >
              <MembersPanel
                projectId={u.hub.id}
                me={user.id}
                canManage={can(u.who, "members:manage")}
                canEmail={invites.canEmail}
                requests={requests}
                team={u.group.name}
                nudge={!u.group.rolesChosenAt && <RolesNudge target={{ groupId: u.group.id }} href={`/g/${u.group.id}/settings#roles`} />}
                members={members.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, signedIn: !!m.user.lastLoginAt, hasPassword: !!m.user.passwordSetAt, avatarAt: m.user.avatarAt, inviteSentAt: invites.sent.get(m.userId) ?? null, inviteUntil: invites.until.get(m.userId) ?? null, ...badgeOf(m.user) }))}
              />
            </ExpandRow>
            </SettingsRows>
          </ul>
        </Card>
      </div>
      <div className="mt-5">
        <CycleSettingsTable
          rows={rows}
          umbrella={name}
          canArchive={canArchiveCycles}
          addButton={can(u.who, "cycle:create") && !u.group.archivedAt ? <AddUmbrellaProject groupId={u.group.id} umbrella={name} platforms={u.platforms.map((p) => p.name)} colors={u.platforms.map((p) => platformColor(u.platforms, p.name))} loose={await looseProjects(user)} label="Add test cycle" /> : undefined}
        />
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
      <div className="mt-5">
        <OtherSettings admin={user.isAdmin} />
      </div>
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

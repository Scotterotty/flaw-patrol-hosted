import Link from "next/link";
import type { Role } from "@prisma/client";
import { RunFieldsPanel } from "@/components/run-fields-settings";
import { RunKindsPanel } from "@/components/run-kinds-settings";
import { parseRunKinds } from "@/lib/run-kinds";
import { parseRunFields } from "@/lib/run-fields";
import { DEFAULT_STORIES, parseStoriesConfig, requirementSource, requirementTypes } from "@/lib/stories-config";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { EditGroupButton, type GroupChoice } from "@/components/group-dialogs";
import { Card, PageHeader } from "@/components/ui";
import { AddUmbrellaProject } from "@/components/umbrella-add-project";
import { ArchiveCard } from "@/components/archive-project";
import { RolesCard } from "@/components/roles-card";
import { AskAdminLine } from "@/components/ask-admin";
import { SentryPanel } from "@/components/sentry-settings";
import { CrownNamesPanel } from "@/components/crown-names";
import { RolesNudge } from "@/components/roles-nudge";
import { SlackCard } from "@/components/slack-card";
import { DigestCard } from "@/components/digest-card";
import { digestCardData } from "@/lib/digest-data";
import { digestSummary, parseDigestSettings } from "@/lib/digest-settings";
import { RegressionPanel } from "@/components/regression-settings";
import { COMPARE_MODES, parseRegressionSettings } from "@/lib/regression";
import { ExpandRow, FoldedRows, SettingsRows } from "@/components/settings-row";
import { AutomationFilesPanel } from "@/components/automation-storage";
import { mb, parseFileSettings } from "@/lib/automation-files";
import { storageUsage } from "@/lib/automation-storage";
import { parseFoundIn } from "@/lib/found-in";
import { BugTemplatePanel, JiraSettings, StoriesPanel } from "@/components/jira-settings";
import { parseSeverityConfig } from "@/lib/severity";
import { MembersPanel } from "@/components/members";
import { CiUploadsPanel } from "@/components/ci-uploads";
import { TeamCityPanel } from "@/components/teamcity-settings";
import { parseBuildTypes } from "@/lib/teamcity-config";
import { GitHubPanel, PullFromGitHubButton } from "@/components/github";
import { QasePanel } from "@/components/qase-settings";
import { parseStatusMap } from "@/lib/qase-map";
import { relativeTime } from "@/lib/format";
import { mySpelling } from "@/lib/session";
import { badgeOf } from "@/lib/game";
import { canOpen } from "@/lib/crypto";
import { slackChannelsByProject, slackChannelsOf } from "@/lib/slack";
import { archiveCardData } from "@/lib/archive-card";
import { UmbrellaIcon } from "@/components/umbrella-nav";
import { parseTemplateSettings, templateKind } from "@/lib/bug-template";
import { db } from "@/lib/db";
import { adminsOf, joinRequestRows } from "@/lib/link-access-server";
import { memberInviteInfo } from "@/lib/invites";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { bugTemplateView } from "@/lib/shared-template-data";
import { loadUmbrella, looseProjects, platformColor } from "@/lib/umbrella";
import { CycleSettingsTable, type CycleChip, type CycleRow } from "@/components/cycle-settings";
import { CyclePanel } from "@/components/cycle-panel";
import { OtherSettings } from "@/components/other-settings";
import { cycleHash } from "@/lib/cycle-hash";
import { BugTemplatesSettings } from "@/components/bug-templates";
import { loadBugTemplates } from "@/lib/bug-templates-data";
import { ToolsPanel } from "@/components/tools";
import { toolHoldings } from "@/lib/tools-data";
import { everything, toolsLine, TOOL_IDS, type ToolId } from "@/lib/tools";
import { NOT_PRACTICE } from "@/lib/practice";

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
  // Asked for together: one round trip's wait instead of twenty in a row.
  const cycles = [...u.current, ...u.older];
  const ids = cycles.map((p) => p.id);
  // Lookups that wait on another one (invites for the members found, each test cycle's
  // bug template, join requests and Slack channels, the Name and test cycles choices) start as soon
  // as what they need arrives, inside the same batch, instead of in rounds after it.
  const cycleWho = (role: Role | null) => ({ role: user.isAdmin ? ("ADMIN" as const) : role, rules: u.who.rules });
  // Who's on the umbrella's team is for Admins only (ver_168): nobody else's page loads the list.
  const seesMembers = can(u.who, "members:manage");
  const membersP = db.projectMember.findMany({ where: { projectId: u.hub.id, ...(seesMembers ? {} : { userId: { in: [] } }) }, include: { user: true }, orderBy: [{ role: "asc" }, { user: { email: "asc" } }] }).then((x) => x);
  const cycleMembersP = db.projectMember.findMany({ where: { projectId: { in: ids } }, include: { user: true }, orderBy: [{ role: "asc" }, { user: { email: "asc" } }] }).then((x) => x);
  const ownJiraP = db.jiraConfig
    .findMany({
      where: { projectId: { in: u.projects.map((p) => p.id) } },
      select: { projectId: true, siteUrl: true, email: true, jiraProjectKey: true, issueType: true, tokenEncrypted: true, bugTemplate: true, stories: true, severity: true, foundIn: true },
    })
    .then((x) => x);
  const myRolesP = db.projectMember.findMany({ where: { userId: user.id, projectId: { in: ids } }, select: { projectId: true, role: true } }).then((x) => x);
  // Renaming and moving test cycles follow the umbrella's own Roles card, not a role on any team.
  const groupManagerP = Promise.resolve(can(u.who, "umbrella:manage"));
  const [
    [jira, members, ownJira, { template, shared }, sentry, requests, bugTemplates, archive, kindSuites, slack, usage, spelling, repos, ciTokens, groupManager, myRoles, cycleMembers, askAdmins],
    [invites, cycleInvites, cycleViews, cycleRequests, ownSlack, visible, loose, holdings, digest],
  ] = await Promise.all([
    Promise.all([
      db.jiraConfig.findUnique({ where: { projectId: u.hub.id } }),
      membersP,
      ownJiraP,
      bugTemplateView(u.hub.id, user.email),
      db.sentryConfig.findUnique({ where: { projectId: u.hub.id } }),
      can(u.who, "members:manage") ? joinRequestRows(u.hub.id) : Promise.resolve([]),
      // Bug templates: a list on the umbrella, used by every test cycle in it.
      loadBugTemplates({ id: u.hub.id, key: u.hub.key, groupId: null }),
      archiveCardData(user, u.group.id, null),
      db.testSuite.findMany({ where: { projectId: u.hub.id, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      slackChannelsOf({ groupId: u.group.id }),
      storageUsage(u.group.id),
      mySpelling(),
      // GitHub: connected repos, and the newest run pulled from each.
      db.gitHubRepo.findMany({
        where: { groupId: u.group.id },
        orderBy: { createdAt: "asc" },
        include: { runs: { orderBy: { createdAt: "desc" }, take: 1, select: { githubRunNo: true, createdAt: true } } },
      }),
      // CI uploads: tokens a pipeline sends with its results file.
      db.ciToken.findMany({ where: { groupId: u.group.id }, orderBy: { createdAt: "asc" } }),
      groupManagerP,
      // Test cycles: who's on each, for its row in the table.
      myRolesP,
      cycleMembersP,
      // Members lists are for Admins only; everyone else is told which Admins to ask.
      seesMembers ? Promise.resolve([] as string[]) : adminsOf(u.hub.id),
    ]),
    Promise.all([
      membersP.then((m) => memberInviteInfo(m.map((x) => x.userId))),
      cycleMembersP.then((m) => memberInviteInfo([...new Set(m.map((x) => x.userId))])),
      // Test cycles with their own Jira show their own bug template.
      ownJiraP.then(async (own) => {
        const here = own.filter((j) => ids.includes(j.projectId));
        return new Map(await Promise.all(here.map(async (j) => [j.projectId, await bugTemplateView(j.projectId, user.email)] as const)));
      }),
      // Join requests for test cycles with their own team, where this person can manage members.
      myRolesP.then(async (roles) => {
        const roleIn = new Map(roles.map((m) => [m.projectId, m.role]));
        const asked = cycles.filter((p) => p.keepMembersSeparate && can(cycleWho(roleIn.get(p.id) ?? null), "members:manage"));
        return new Map(await Promise.all(asked.map(async (p) => [p.id, await joinRequestRows(p.id)] as const)));
      }),
      slackChannelsByProject(ids),
      groupManagerP.then((ok) =>
        ok
          ? db.project.findMany({
              where: { hubOf: null, ...NOT_PRACTICE, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) },
              include: { members: { where: { userId: user.id } }, group: { select: { name: true } } },
              orderBy: { name: "asc" },
            })
          : [],
      ),
      can(u.who, "cycle:create") && !u.group.archivedAt ? looseProjects(user) : Promise.resolve([]),
      toolHoldings(u, TOOL_IDS),
      // Email digests: the umbrella's choice, the email groups and who can be picked.
      digestCardData(u.group.emailDigest, [u.hub.id, ...ids]),
    ]),
  ]);
  // Qase: the connection, and how many library cases are linked.
  const [qase, teamcity] = await Promise.all([db.qaseConfig.findUnique({ where: { groupId: u.group.id } }), db.teamCityConfig.findUnique({ where: { groupId: u.group.id } })]);
  // TeamCity (ver_228): the builds watched on Status.
  const watched = teamcity ? parseBuildTypes(teamcity.buildTypes) : [];
  const teamcityText = teamcity
    ? `${teamcity.baseUrl.replace(/^https?:\/\//, "")} · ${watched.length ? `watching ${watched.map((b) => b.name).join(", ")}` : "no builds picked yet"}`
    : "Show your TeamCity builds on Status. Read-only.";
  const qaseLinks = qase
    ? await Promise.all([
        db.testCase.count({ where: { project: { OR: [{ groupId: u.group.id }, { hubOf: { id: u.group.id } }] }, archived: false, qaseId: { gt: 0 } } }),
        db.testCase.count({ where: { project: { OR: [{ groupId: u.group.id }, { hubOf: { id: u.group.id } }] }, archived: false, OR: [{ qaseId: null }, { qaseId: { gt: 0 } }] } }),
      ]).then(([linked, total]) => ({ linked, total }))
    : null;
  const qaseText = qase
    ? `${qase.projectTitle} (${qase.projectCode}) · ${qase.send && qase.bring ? "results go both ways" : qase.send ? "sends results to Qase" : qase.bring ? "brings Qase results in" : "sharing turned off"}${qaseLinks ? ` · ${qaseLinks.linked} of ${qaseLinks.total} cases linked` : ""}`
    : "Not connected. Share test results with a Qase project, both ways.";
  // Tools: off tools' rows leave Settings, like they leave the menu.
  const on = (t: ToolId) => u.tools.includes(t);
  const leads = members.filter((m) => m.role === "LEAD" || m.role === "ADMIN").length;
  const manage = can(u.who, "jira:manage");
  const canTemplates = can(u.who, "bugtemplate:edit");
  const templatesText = `${bugTemplates.templates.length + 1} ${bugTemplates.templates.length ? "templates" : "template"} · default: ${bugTemplates.templates.find((t) => t.id === bugTemplates.defaultId)?.name ?? bugTemplates.current.name}`;
  const runFields = parseRunFields(u.group.runFields);
  const runKinds = parseRunKinds(u.group.runKinds);
  const reg = parseRegressionSettings(u.group.regression);
  const fileSettings = parseFileSettings(u.group.automationFiles);
  const slackPaused = slack.length > 0 && slack.every((c) => c.paused);
  const canPull = can(u.who, "run:import") && !u.group.archivedAt;
  const pullable = repos.filter((r) => r.workflowId).map((r) => ({ id: r.id, fullName: r.fullName, workflowName: r.workflowName }));
  const githubText = repos.length
    ? repos
        .map((r) =>
          [r.fullName, r.workflowName ? `workflow ${r.workflowName}` : "Setup not finished: pick which workflow's test results to pull", r.runs[0] ? `last pulled GitHub run ${r.runs[0].githubRunNo}, ${relativeTime(r.runs[0].createdAt, spelling)}` : "nothing pulled yet"].join(" · "),
        )
        .join("; ")
    : "Bring in test results from a GitHub repo's workflow runs.";
  // Only once a repo is connected and set up: before that there is nothing to pull.
  const pullButton = canPull && pullable.length > 0 ? <PullFromGitHubButton groupId={u.group.id} repos={pullable} size="sm" variant="primary" /> : null;
  const githubStatus = (
    <>
      {repos.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">✓ Connected</span>}
      {pullButton}
    </>
  );
  const ciText = ciTokens.length
    ? `${ciTokens.length} ${ciTokens.length === 1 ? "token" : "tokens"} · ${ciTokens.some((t) => t.lastUsedAt) ? `last upload ${relativeTime(new Date(Math.max(...ciTokens.map((t) => t.lastUsedAt?.getTime() ?? 0))), spelling)}` : "no uploads yet"}`
    : "Let your pipeline send its results file after every build, with no one pressing Upload.";
  const hubKind = templateKind(template);
  const kindLabel = (k: "plain" | "imported" | "detailed") => (k === "imported" ? "Imported" : k === "detailed" ? "OKO layout" : "Plain layout");
  const whose = name.endsWith("s") ? `${name}'` : `${name}'s`;
  const site = jira?.siteUrl.replace(/^https?:\/\//, "");
  const storiesText = !jira
    ? "Connect Jira first to link cases to Jira requirements."
    : (() => {
        const st = parseStoriesConfig(jira.stories) ?? DEFAULT_STORIES;
        const source = requirementSource(st, jira.jiraProjectKey);
        return `${source.charAt(0).toUpperCase()}${source.slice(1)} · ${requirementTypes(st)}${st.rollUp ? " · Epics count their child issues" : ""} · bug box ${st.linkBugs ? "links bugs to requirements" : "doesn't link bugs"} by default`;
      })();

  let choices: GroupChoice[] = [];
  if (groupManager) {
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

  // Test cycles: each one's row in the table, with what it can set for itself opening below.
  const umbrellaChannelIds = slack.map((c) => c.id);
  const roleIn = new Map(myRoles.map((m) => [m.projectId, m.role]));
  const jiraOf = new Map(ownJira.map((j) => [j.projectId, j]));
  const canArchiveCycles = !!archive?.umbrella?.cycles.length;
  const rows: CycleRow[] = cycles.map((p) => {
    const cw = cycleWho(roleIn.get(p.id) ?? null);
    const mine = jiraOf.get(p.id);
    const people = cycleMembers.filter((m) => m.projectId === p.id);
    const fromUmbrella = people.filter((m) => m.fromUmbrella).length;
    const mode = (MODES as readonly string[]).includes(p.slackMode) ? (p.slackMode as (typeof MODES)[number]) : "umbrella";
    const picked = p.slackChannelIds.filter((id) => umbrellaChannelIds.includes(id));
    const ownChannels = ownSlack.get(p.id) ?? [];
    const view = mine ? (cycleViews.get(p.id) ?? null) : null;
    const requestsHere = cycleRequests.get(p.id) ?? [];
    const team: CycleChip = p.keepMembersSeparate
      ? { tone: "own", text: can(cw, "members:manage") ? `Its own · ${people.length} ${people.length === 1 ? "person" : "people"}` : "Its own", tip: "Only the people added to this test cycle can see it." }
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
        pin={p.archivedAt ? null : { projectId: p.id, on: p.keepCurrent, platform: p.platform, canChange: can(cw, "cycle:archive") }}
        details={can(cw, "project:manage") ? { projectId: p.id, name: p.name, description: p.description } : null}
        clients={p.archivedAt ? undefined : { projectId: p.id, list: p.clients, canChange: can(cw, "project:manage"), cycle: p.name }}
        team={{
          projectId: p.id,
          separate: p.keepMembersSeparate,
          canSeparate: can(cw, "project:separate"),
          fromUmbrella,
          seesMembers: can(cw, "members:manage"),
          ask: <AskAdminLine admins={(() => { const own = people.filter((m) => m.role === "ADMIN").map((m) => m.user.name ?? m.user.email); return own.length ? own : askAdmins; })()} />,
          members: p.keepMembersSeparate && can(cw, "members:manage") ? (
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
              foundIn={parseFoundIn(mine.foundIn)}
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
        digest={{
          projectId: p.id,
          mode: (["umbrella", "choose", "off"].includes(p.emailDigestMode) ? p.emailDigestMode : "umbrella") as "umbrella" | "choose" | "off",
          umbrella: name,
          umbrellaSummary: digest.summary,
          canManage: can(cw, "jira:manage"),
          isAdmin: user.isAdmin,
          team: p.name,
          own: (() => {
            const settings = parseDigestSettings(p.emailDigest);
            return { ...digest, settings, summary: digestSummary(settings, settings.groupIds.map((id) => digest.groups.find((g) => g.id === id)?.name ?? "").filter(Boolean)) };
          })(),
        }}
      />
    );
    return { key: p.key, id: p.id, archived: archivedAlone, name: p.name.startsWith(`${name} `) ? p.name.slice(name.length + 1) : p.name, fullName: p.name, color: platformColor(u.platforms, p.platform), older: u.older.some((o) => o.id === p.id), team, jira: jiraChip, slack: slackChip, panel };
  });

  // Members' Settings (Monday audit, kept in ver_200's groups): rows they can only look at fold
  // under one "Team setup · Admins change these" line, and Your account comes first.
  const foldLookOnly = !manage;
  const lookOnly: ReactNode[] = [];
  const keep = (change: boolean, node: ReactNode) => {
    if (!foldLookOnly || change) return node;
    lookOnly.push(<Fragment key={lookOnly.length}>{node}</Fragment>);
    return null;
  };
  const testingRows = [on("runs") && can(u.who, "umbrella:fields"), canTemplates, on("runs") && can(u.who, "run:manage")].some(Boolean);
  const moreRows = [u.role === "ADMIN" && !u.group.archivedAt, on("auto") && can(u.who, "run:manage"), on("quest") && can(u.who, "umbrella:manage")].some(Boolean);
  // ver_200: Settings sorted into People · Testing · Connections · More, Members first.
  const notConnected = <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Not connected</span>;
  const connected = <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Connected</span>;
  const storiesOn = on("stories");
  const jiraText = jira
    ? `${site} · Jira project ${jira.jiraProjectKey} · token from ${jira.email}${storiesOn ? " · Requirements on" : ""}`
    : `Not connected. Connect it once here and every ${name} test cycle files bugs into it.${storiesOn ? " It also turns on Requirements." : ""}`;
  const groups = [
    { id: "people", title: "People", show: seesMembers || can(u.who, "members:manage") },
    { id: "testing", title: "Testing", show: true },
    { id: "connections", title: "Connections", show: !foldLookOnly },
    { id: "more", title: "More", show: !foldLookOnly || moreRows || !!archive },
  ].filter((g) => g.show);
  return (
    <div className="page page-settings">
      <PageHeader
        title="Settings"
        subtitle={on("runs") ? `${name} and its test cycles` : `Everything ${name} uses`}
        actions={
          groupManager ? <EditGroupButton group={u.group} choices={choices} label="Rename" umbrella /> : undefined
        }
      />
      {!seesMembers && <AskAdminLine admins={askAdmins} className="-mt-2 mb-4" />}
      {/* Your account first for people who mostly look here (Monday audit). */}
      {foldLookOnly && (
        <div className="mb-5">
          <OtherSettings admin={user.isAdmin} />
        </div>
      )}
      {on("runs") && (
      <p className="mb-4 flex items-start gap-2 rounded-lg bg-accent-50 px-4 py-2.5 text-sm text-accent-700" data-testid="settings-scope">
        <UmbrellaIcon className="mt-0.5 size-4 flex-none" />
        <span>
          Changes here apply to <b>every test cycle in {name}</b>. The <b>Test cycles</b> table shows any that are set differently.
        </span>
      </p>
      )}
      <nav aria-label="Settings groups" className="mb-5 flex flex-wrap items-center gap-1.5" data-testid="settings-jump">
        {groups.map((g) => (
          <a key={g.id} href={`#group-${g.id}`} className="rounded-full border border-slate-300 bg-surface px-3 py-1 text-xs font-medium text-slate-700 hover:border-accent-500 hover:text-accent-700">
            {g.title}
          </a>
        ))}
      </nav>
      <SettingsRows>
        {seesMembers || can(u.who, "members:manage") ? (
          <SettingsGroup id="people" title="People">
            {seesMembers && (
              <Card>
                <ul className="divide-y divide-slate-100">
                  <ExpandRow
                    id="members"
                    hashes={["members"]}
                    title="Members"
                    howto="settings-members"
                    text={`${requests.length ? `${requests.length} asking to join · ` : ""}${members.length} ${members.length === 1 ? "person" : "people"} · ${leads} ${leads === 1 ? "lead or admin" : "leads and admins"} · everyone gets every ${name} test cycle unless it keeps members separate`}
                    label="Manage"
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
                </ul>
              </Card>
            )}
            {can(u.who, "members:manage") && <RolesCard target={{ groupId: u.group.id }} rules={u.who.rules ?? null} appliesTo={`${name}, its Case library and all its test cycles`} />}
          </SettingsGroup>
        ) : null}

        <SettingsGroup id="testing" title="Testing">
          {on("runs") && (
            <CycleSettingsTable
              rows={rows}
              umbrella={name}
              canArchive={canArchiveCycles}
              canChange={u.who.role !== "VIEWER"}
              addButton={can(u.who, "cycle:create") && !u.group.archivedAt ? <AddUmbrellaProject groupId={u.group.id} umbrella={name} platforms={u.platforms.map((p) => p.name)} colors={u.platforms.map((p) => platformColor(u.platforms, p.name))} loose={loose} label="Add test cycle" /> : undefined}
            />
          )}
          {hideIf(foldLookOnly && !testingRows, <Card>
            <ul className="divide-y divide-slate-100">
              {keep(can(u.who, "umbrella:fields"), <>
              {on("runs") && (
              <ExpandRow howto="settings-run-kinds"
                id="run-kinds"
                hashes={["run-kinds"]}
                title="Run kinds"
                text={runKinds.filter((k) => !k.hidden).map((k) => k.name).join(", ")}
                label={can(u.who, "umbrella:fields") ? "Change" : "View"}
              >
                <RunKindsPanel groupId={u.group.id} umbrella={name} kinds={runKinds} suites={kindSuites} canEdit={can(u.who, "umbrella:fields") && !u.group.archivedAt} newSuiteHref={can(u.who, "suite:manage") ? `/p/${u.hub.key}/suites/new` : undefined} />
              </ExpandRow>
              )}
              </>)}
              {keep(can(u.who, "umbrella:fields"), <>
              {on("runs") && (
              <ExpandRow howto="settings-run-fields"
                id="run-fields"
                hashes={["run-fields"]}
                title="Run fields"
                text={runFields.length ? `Release, Version, Environment and ${runFields.map((f) => f.name).join(", ")}` : "Release, Version and Environment. Add your own, like a firmware or API version."}
                label={can(u.who, "umbrella:fields") ? "Change" : "View"}
              >
                <RunFieldsPanel groupId={u.group.id} umbrella={name} fields={runFields} canEdit={can(u.who, "umbrella:fields") && !u.group.archivedAt} />
              </ExpandRow>
              )}
              </>)}
              {keep(canTemplates, <>
              <ExpandRow id="bug-templates" howto="settings-bug-templates" hashes={["bug-templates", "template", "import-template"]} title="Bug templates" text={templatesText} label={canTemplates ? "Change" : "Open"}>
                <BugTemplatesSettings
                  projectId={u.hub.id}
                  current={bugTemplates.current}
                  templates={bugTemplates.templates}
                  defaultId={bugTemplates.defaultId}
                  canEdit={canTemplates}
                  canDelete={can(u.who, "bugtemplate:delete")}
                  jiraConnected={!!jira}
                  currentPanel={manage && jira ? <BugTemplatePanel projectId={u.hub.id} template={template} jiraProjectKey={jira.jiraProjectKey} tokenReadable={canOpen(jira.tokenEncrypted)} shared={shared} /> : null}
                />
              </ExpandRow>
              </>)}
              {keep(can(u.who, "run:manage"), <>
              {on("runs") && (
              <ExpandRow howto="settings-regression"
                id="regression"
                hashes={["regression"]}
                title="Regression flag"
                text={reg.on ? `On · compares with ${COMPARE_MODES.find((m) => m.id === reg.compare)!.label.toLowerCase()} · Jira label ${reg.label}` : "Off. Tests that passed before and fail now aren't marked."}
                label={can(u.who, "run:manage") ? "Change" : "View"}
              >
                <RegressionPanel groupId={u.group.id} settings={reg} canEdit={can(u.who, "run:manage") && !u.group.archivedAt} />
              </ExpandRow>
              )}
              </>)}
            </ul>
          </Card>)}
        </SettingsGroup>

        {hideIf(foldLookOnly, <SettingsGroup id="connections" title="Connections">
          <Card>
            <ul className="divide-y divide-slate-100">
              {keep(manage, <>
              {manage ? (
                <ExpandRow
                  id="jira"
                  howto="settings-jira"
                  hashes={["jira", "stories"]}
                  title="Jira"
                  text={jiraText}
                  label={jira ? "Change" : "Connect"}
                  status={jira ? connected : notConnected}
                >
                  <JiraSettings
                    projectId={u.hub.id}
                    current={jira && { siteUrl: jira.siteUrl, email: jira.email, jiraProjectKey: jira.jiraProjectKey, issueType: jira.issueType, tokenReadable: canOpen(jira.tokenEncrypted) }}
                    template={template}
                    connectionOnly
                    severity={parseSeverityConfig(jira?.severity)}
                    foundIn={parseFoundIn(jira?.foundIn)}
                  />
                  {storiesOn && jira && (
                    // ver_200: Requirements needs Jira, so it lives inside the Jira row.
                    <div data-howto="settings-requirements">
                      <StoriesPanel projectId={u.hub.id} stories={parseStoriesConfig(jira.stories)} bugProject={jira.jiraProjectKey} />
                    </div>
                  )}
                </ExpandRow>
              ) : (
                <Row
                  title="Jira"
                  text={jira ? `${site} · Jira project ${jira.jiraProjectKey}${storiesOn ? ` · Requirements: ${storiesText}` : ""}` : `Not connected yet.`}
                  action={jira ? connected : notConnected}
                />
              )}
              <ExpandRow
                id="slack"
                howto="settings-slack"
                hashes={["slack"]}
                title="Slack alerts"
                text={slack.length ? `${slackPaused ? "Paused · " : ""}${slack.map((c) => c.name).join(", ")} · every test cycle follows unless changed` : "No channels yet. Post regressions, serious bugs and finished runs to Slack."}
                label={manage ? (slack.length ? "Manage" : "Set up") : "View"}
              >
                <SlackCard target={{ groupId: u.group.id }} channels={slack} canManage={manage} tip={`Post to Slack when something needs the team's eyes. Each channel picks its own alerts. Every ${name} test cycle follows these channels unless its own Settings change that.`} />
              </ExpandRow>
              <ExpandRow id="email-digests" howto="settings-digests" hashes={["email-digests"]} title="Email digests" text={digest.summary} label={manage ? (digest.settings.on ? "Change" : "Set up") : "View"}>
                <DigestCard target={{ groupId: u.group.id }} data={digest} canManage={manage && !u.group.archivedAt} team={name} isAdmin={user.isAdmin} />
              </ExpandRow>
              {!on("auto") ? null : manage ? (
                <ExpandRow
                  id="github"
                  howto="settings-github"
                  hashes={["github"]}
                  title="GitHub"
                  text={githubText}
                  label={repos.length ? "Change" : "Connect"}
                  status={repos.length ? githubStatus : notConnected}
                >
                  <GitHubPanel groupId={u.group.id} repos={repos.map((r) => ({ id: r.id, fullName: r.fullName, workflowId: r.workflowId, workflowName: r.workflowName, glob: r.resultsGlob, bringFiles: r.bringFiles }))} />
                </ExpandRow>
              ) : (
                <Row title="GitHub" text={githubText} action={repos.length ? githubStatus : notConnected} />
              )}
              {!on("auto") ? null : manage ? (
                <ExpandRow id="ci-uploads" howto="settings-ci" hashes={["ci-uploads"]} title="CI uploads" text={ciText} label={ciTokens.length ? "Manage" : "Set up"}>
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
                id="teamcity"
                howto="settings-teamcity"
                hashes={["teamcity"]}
                title="TeamCity"
                text={teamcityText}
                label={manage ? (teamcity ? "Change" : "Connect") : "View"}
                status={teamcity ? connected : notConnected}
              >
                <TeamCityPanel
                  groupId={u.group.id}
                  canEdit={manage && !u.group.archivedAt}
                  statusHref={`/g/${u.group.id}/status`}
                  saved={teamcity && { baseUrl: teamcity.baseUrl, buildTypes: watched, tokenReadable: canOpen(teamcity.tokenEncrypted) }}
                />
              </ExpandRow>
              <ExpandRow howto="settings-sentry"
                id="sentry"
                hashes={["sentry"]}
                title="Sentry"
                text={sentry ? `${sentry.org} · ${projectsOfSentry(sentry.projects).map((p) => p.slug).join(", ")}${sentry.environment ? ` · ${sentry.environment}` : ""}` : "See the app's errors next to failed steps and add them to bugs."}
                label={manage ? (sentry ? "Change" : "Connect") : "View"}
                status={sentry ? connected : notConnected}
              >
                <SentryPanel
                  projectId={u.hub.id}
                  canManage={manage}
                  fields={runFields.map((f) => ({ id: f.id, name: f.name }))}
                  saved={sentry && { baseUrl: sentry.baseUrl, org: sentry.org, connectedAs: sentry.connectedAs, projects: projectsOfSentry(sentry.projects), environment: sentry.environment, buildField: sentry.buildField, onlyTester: sentry.onlyTester, tokenReadable: canOpen(sentry.tokenEncrypted) }}
                />
              </ExpandRow>
              {on("runs") && (
                <ExpandRow howto="settings-qase"
                  id="qase"
                  hashes={["qase"]}
                  title="Qase"
                  text={qaseText}
                  label={manage ? (qase ? "Change" : "Connect") : "View"}
                  status={qase ? connected : notConnected}
                >
                  <QasePanel
                    groupId={u.group.id}
                    canEdit={manage && !u.group.archivedAt}
                    linkHref={`/g/${u.group.id}/qase`}
                    links={qaseLinks}
                    saved={qase && { projectCode: qase.projectCode, projectTitle: qase.projectTitle, send: qase.send, bring: qase.bring, statusMap: parseStatusMap(qase.statusMap), tokenReadable: canOpen(qase.tokenEncrypted), hookPath: manage ? `/api/qase/hook/${qase.hookSecret}` : "" }}
                  />
                </ExpandRow>
              )}
              </>)}
            </ul>
          </Card>
        </SettingsGroup>)}

        {hideIf(foldLookOnly && !moreRows && !archive, <SettingsGroup id="more" title="More">
          {hideIf(foldLookOnly && !moreRows, <Card>
            <ul className="divide-y divide-slate-100">
              {keep(u.role === "ADMIN" && !u.group.archivedAt, <>
              <ExpandRow
                id="tools"
                howto="settings-tools"
                hashes={["tools"]}
                title="Tools"
                text={everything(u.tools) ? "Every tool: test cases, runs, bug bashes, risk board and the rest" : toolsLine(u.tools)}
                label={u.role === "ADMIN" && !u.group.archivedAt ? "Change" : "View"}
              >
                <ToolsPanel groupId={u.group.id} umbrella={name} tools={u.tools} canEdit={u.role === "ADMIN" && !u.group.archivedAt} counts={holdings} jira={jira?.jiraProjectKey ?? null} />
              </ExpandRow>
              </>)}
              {keep(can(u.who, "run:manage"), <>
              {on("auto") && (
              <ExpandRow howto="settings-media"
                id="automation-files"
                hashes={["automation-files"]}
                title="Screenshots, videos and replays"
                text={`From automation · keeping ${fileSettings.keep === "failed" ? "failed and flaky tests only" : "every test"}, up to ${fileSettings.maxMb} MB a file · using ${mb(usage.bytes)}`}
                label={can(u.who, "run:manage") ? "Change" : "View"}
              >
                <AutomationFilesPanel groupId={u.group.id} settings={fileSettings} usage={usage} canEdit={can(u.who, "run:manage") && !u.group.archivedAt} />
              </ExpandRow>
              )}
              </>)}
              {keep(can(u.who, "umbrella:manage"), <>
              {on("quest") && (
              <ExpandRow
                id="crowns"
                hashes={["crowns"]}
                title="Mini game crowns"
                text={u.platforms.length ? u.platforms.map((p) => p.crownName || `Ruler of ${p.name}`).join(", ") : "One crown per platform, for whoever runs the most there"}
                label={can(u.who, "umbrella:manage") ? "Change" : "View"}
              >
                <CrownNamesPanel groupId={u.group.id} platforms={u.platforms} canEdit={can(u.who, "umbrella:manage") && !u.group.archivedAt} />
              </ExpandRow>
              )}
              </>)}
            </ul>
          </Card>)}
          {archive && <ArchiveCard data={archive} />}
        </SettingsGroup>)}
        {foldLookOnly && lookOnly.length > 0 && (
          <Card className="mb-6">
            <ul>
              <FoldedRows title="Team setup · Admins change these" sub={lookOnly.length === 1 ? "1 setting you can look at" : `${lookOnly.length} settings you can look at`} hashes={["tools", "jira", "stories", "slack", "email-digests", "sentry", "github", "ci-uploads", "teamcity", "qase", "run-fields", "run-kinds", "regression", "automation-files", "crowns", "bug-templates"]}>
                {lookOnly}
              </FoldedRows>
            </ul>
          </Card>
        )}
      </SettingsRows>
      {!foldLookOnly && (
        <div className="mt-6">
          <OtherSettings admin={user.isAdmin} />
        </div>
      )}
    </div>
  );
}

/** Leaves a part out while still building it, so its look-only rows still reach the Team setup fold. */
const hideIf = (hide: boolean, node: ReactNode) => (hide ? null : node);

/** One group of umbrella Settings (People, Testing, Connections, More), with its heading for the jump bar. */
function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`group-${id}`} aria-labelledby={`group-${id}-h`} className="mb-6 scroll-mt-20 space-y-3">
      <h2 id={`group-${id}-h`} className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h2>
      {children}
    </section>
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

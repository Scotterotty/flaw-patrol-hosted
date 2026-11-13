import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AccountTabs } from "@/components/account-tabs";
import { ActivityLog } from "@/components/activity-log";
import { GameAdminCard } from "@/components/game-admin-card";
import { ProjectMenu } from "@/components/project-menu";
import { TopBar } from "@/components/top-bar";
import { PageHeader } from "@/components/ui";
import { WorkspaceBugTemplates } from "@/components/workspace-bug-templates";
import { WorkspaceAdmins } from "@/components/workspace-admins";
import { WorkspaceEmail, type MailView } from "@/components/workspace-email";
import { EmailGroupsCard } from "@/components/digest-card";
import { emailGroupViews, pickablePeople } from "@/lib/digest-data";
import { WorkspaceSignIn, type ProviderView } from "@/components/workspace-sign-in";
import { WorkspaceUpdates } from "@/components/workspace-updates";
import { readServerUpdate } from "@/lib/server-update-files";
import { APP_VERSION } from "@/lib/version";
import { pruneActivity } from "@/lib/activity";
import type { ActivityFilters } from "@/lib/activity-query";
import { canOpen } from "@/lib/crypto";
import { db } from "@/lib/db";
import { mySpelling, requireUser } from "@/lib/session";
import { sharedTemplateList, shareSources } from "@/lib/shared-template-data";
import { COMPANY_PROVIDERS, domainList, envProviders, PROVIDER_NAME } from "@/lib/sign-in-config";

export const metadata = { title: "Workspace settings" };

/** Workspace admins only: company sign-in, email, the activity log, the game admin and updates. */
export default async function WorkspacePage({ searchParams }: { searchParams: Promise<ActivityFilters & { tested?: string }> }) {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  const { tested, ...filters } = await searchParams;
  await pruneActivity();
  const [ws, rows, last, spelling, templates, sources, groups, people, updates] = await Promise.all([
    db.workspace.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    db.signInProvider.findMany(),
    db.projectPin.findFirst({
      where: { userId: user.id, visitedAt: { not: null }, project: { archivedAt: null, members: { some: { userId: user.id } } } },
      orderBy: { visitedAt: "desc" },
      select: { project: { select: { id: true, key: true, name: true, groupId: true, platform: true } } },
    }),
    mySpelling(),
    sharedTemplateList(),
    shareSources(),
    emailGroupViews(),
    pickablePeople("all"),
    readServerUpdate(),
  ]);
  const admins = (await db.user.findMany({ where: { isAdmin: true }, orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true, name: true, email: true } })).map((u) => ({ id: u.id, name: u.name || u.email, email: u.email }));
  const env = envProviders();
  const providers: ProviderView[] = COMPANY_PROVIDERS.map((id) => {
    const r = rows.find((x) => x.id === id);
    return {
      id,
      name: PROVIDER_NAME[id],
      fromEnv: id === "google" && !!env.google,
      saved: r
        ? {
            clientId: r.clientId,
            tenantId: r.tenantId,
            issuer: r.issuer,
            label: r.label,
            hasSecret: !!r.secretEncrypted,
            secretReadable: !!r.secretEncrypted && canOpen(r.secretEncrypted),
            secretExpires: r.secretExpires?.toISOString() ?? null,
            joinDomains: r.joinDomains,
            enabled: r.enabled,
            testedAt: r.testedAt?.toISOString() ?? null,
            testedEmail: r.testedEmail,
          }
        : null,
    };
  });
  const mail: MailView = {
    mode: (["off", "microsoft365", "google", "smtp"].includes(ws.mailMode) ? ws.mailMode : "off") as MailView["mode"],
    host: ws.mailHost,
    port: ws.mailPort,
    security: ws.mailSecurity,
    user: ws.mailUser,
    hasPassword: !!ws.mailPassEncrypted,
    passwordReadable: !!ws.mailPassEncrypted && canOpen(ws.mailPassEncrypted),
    fromName: ws.mailFromName,
    fromAddress: ws.mailFromAddress,
  };
  const h = await headers();
  const callbackBase = (process.env.AUTH_URL?.replace(/\/+$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`).replace(/\/api\/auth$/, "");

  return (
    <>
      <TopBar user={user} />
      <div className="flex">
        {last && <ProjectMenu project={last.project} user={user} />}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
          <div className="page page-settings">
            <PageHeader title="Workspace settings" subtitle="Only workspace admins see this page." />
            <AccountTabs
              label="Workspace sections"
              tabs={[
                ["admins", "Admins"],
                ["sign-in", "Sign-in"],
                ["email", "Email"],
                ["bug-templates", "Bug templates"],
                ["activity", "Activity log"],
                ["game-admin", "Game admin"],
                ["updates", "Updates"],
              ]}
            />
            <div className="space-y-5">
              <WorkspaceAdmins admins={admins} people={people} meId={user.id} />
              <WorkspaceSignIn
                password={{ on: ws.passwordSignIn, joinDomains: ws.joinDomains, envDomains: domainList(process.env.AUTH_ALLOWED_DOMAINS).join(", ") }}
                providers={providers}
                githubFromEnv={!!env.github}
                callbackBase={callbackBase}
                tested={tested ?? null}
              />
              <WorkspaceEmail saved={mail} />
              <EmailGroupsCard groups={groups} people={people} isAdmin={user.isAdmin} />
              <WorkspaceBugTemplates list={templates} sources={sources} joinDomains={ws.joinDomains} />
              <ActivityLog filters={filters} spelling={spelling} />
              <GameAdminCard />
              <WorkspaceUpdates initial={{ ...updates, running: APP_VERSION }} />
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

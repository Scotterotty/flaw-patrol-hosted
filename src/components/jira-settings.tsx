"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import { FIELD_SOURCES, SECTION_SOURCES, templateKind, type FieldSource, type ImportedTemplate, type SectionSource, type TemplateSettings } from "@/lib/bug-template";
import {
  checkBugTemplate,
  checkFoundIn,
  checkJiraReporters,
  readBugTemplate,
  removeJiraConfig,
  saveBugTemplate,
  saveFoundIn,
  saveImportedTemplate,
  jiraSeverityFields,
  saveJiraConfig,
  saveSeverityField,
  setPlainLayout,
} from "@/server/jira";
import type { SharedView } from "@/lib/shared-template-data";
import { pickSharedTemplate } from "@/server/shared-templates";
import { PLAIN_SCALE, SEVERITIES, type SeverityConfig } from "@/lib/severity";
import { loadIssueTypes, saveStoriesConfig } from "@/server/stories";
import { DEFAULT_STORIES, STORY_TYPES, type StoriesConfig } from "@/lib/stories-config";
import { FOUND_IN_FIELDS, type FoundInConfig, type FoundInField } from "@/lib/found-in";
import { Button, Card, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";
import { PrioritySettings } from "./jira-priority";

export function JiraSettings({
  projectId,
  current,
  template,
  stories = null,
  connectionOnly = false,
  shared,
  severity = null,
  foundIn = null,
}: {
  projectId: string;
  current: { siteUrl: string; email: string; jiraProjectKey: string; issueType: string; tokenReadable: boolean } | null;
  template: TemplateSettings;
  stories?: StoriesConfig | null;
  /** The umbrella's Settings show the bug template and stories in rows of their own. */
  connectionOnly?: boolean;
  /** Company bug templates this person may pick, and the one in use. */
  shared?: SharedView;
  /** Settings → Jira → Severity field. */
  severity?: SeverityConfig | null;
  /** Settings → Jira → Found-in version. */
  foundIn?: FoundInConfig | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Bumped after each save so the reporter check runs again.
  const [checked, setChecked] = useState(0);
  return (
    <Card id="jira" className="scroll-mt-20 p-5">
      <h2 className="text-sm font-semibold text-slate-800">Jira</h2>
      <p className="mt-1 mb-4 text-xs text-slate-500">
        {current
          ? `Connected to ${current.siteUrl}, Jira project ${current.jiraProjectKey}. People can file and link ${current.issueType} issues from any test step.`
          : "Connect a Jira Cloud project so testers can file new bugs, or link existing ones, straight from a test step."}
      </p>
      {current && !current.tokenReadable && (
        <div className="mb-4 text-xs">
        <ErrorText>
          The saved API token can&apos;t be read by this copy of Flaw Patrol, so filing and linking bugs won&apos;t work. It was saved with a different
          AUTH_SECRET (another copy using this database, or an older .env). Paste the API token again below, and give every copy that shares this
          database the same AUTH_SECRET in its .env.
        </ErrorText>
        </div>
      )}
      <form
        className="space-y-3"
        action={(fd) =>
          start(async () => {
            setOk(null);
            const res = await saveJiraConfig(projectId, {
              siteUrl: String(fd.get("siteUrl")),
              email: String(fd.get("email")),
              token: String(fd.get("token") ?? ""),
              jiraProjectKey: String(fd.get("jiraProjectKey")),
              issueType: String(fd.get("issueType") || "Bug"),
            });
            if (!res.ok) return setError(res.error);
            setError(null);
            setOk(`Connected as ${res.connectedAs}.`);
            setChecked((n) => n + 1);
            router.refresh();
          })
        }
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {ok && <p className="text-sm text-emerald-700">{ok}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jira site" htmlFor="jira-site">
            <Input id="jira-site" name="siteUrl" required defaultValue={current?.siteUrl} placeholder="https://yourcompany.atlassian.net" />
          </Field>
          <Field label="Jira project key" htmlFor="jira-project">
            <Input id="jira-project" name="jiraProjectKey" required defaultValue={current?.jiraProjectKey} placeholder="QA" className="uppercase" />
          </Field>
          <Field label="Account email" htmlFor="jira-email" hint="Flaw Patrol talks to Jira as this account. Each bug's reporter is the tester who filed it.">
            <Input id="jira-email" name="email" type="email" required defaultValue={current?.email} />
          </Field>
          <Field
            label="API token"
            htmlFor="jira-token"
            hint={
              <>
                Create one at{" "}
                <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
                  id.atlassian.com
                </a>
                . Stored encrypted.{current && " Leave blank to keep the current one."}
              </>
            }
          >
            <Input id="jira-token" name="token" type="password" autoComplete="off" required={!current || !current.tokenReadable} />
          </Field>
          <Field label="Issue type" htmlFor="jira-type">
            <Input id="jira-type" name="issueType" defaultValue={current?.issueType ?? "Bug"} />
          </Field>
        </div>
        {current?.tokenReadable && <ReporterCheck key={checked} projectId={projectId} />}
        {current?.tokenReadable && <SeveritySettings key={`sev-${checked}`} projectId={projectId} saved={severity} />}
        {current?.tokenReadable && <FoundInSettings key={`found-${checked}`} projectId={projectId} saved={foundIn} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Checking…" : current ? "Save and test" : "Connect Jira"}
          </Button>
          {current && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                confirm("Disconnect Jira? Bugs already linked keep their links.") &&
                start(async () => {
                  await removeJiraConfig(projectId);
                  router.refresh();
                })
              }
            >
              Disconnect
            </Button>
          )}
        </div>
      </form>
      {!connectionOnly && (current?.tokenReadable ? <BugTemplateSettings key={checked} projectId={projectId} saved={template} jiraProjectKey={current.jiraProjectKey} shared={shared} /> : <BugTemplateLocked />)}
      {!connectionOnly && current && <StoriesSettings projectId={projectId} saved={stories ?? DEFAULT_STORIES} bugProject={current.jiraProjectKey} />}
    </Card>
  );
}

/** The umbrella's Settings → Bug template row, on its own. */
export function BugTemplatePanel({ projectId, template, jiraProjectKey, tokenReadable, shared }: { projectId: string; template: TemplateSettings; jiraProjectKey: string; tokenReadable: boolean; shared?: SharedView }) {
  return <Card className="p-5">{tokenReadable ? <BugTemplateSettings projectId={projectId} saved={template} jiraProjectKey={jiraProjectKey} shared={shared} standalone /> : <BugTemplateLocked standalone />}</Card>;
}

/** The umbrella's Settings → Requirements row, on its own. */
export function StoriesPanel({ projectId, stories, bugProject }: { projectId: string; stories: StoriesConfig | null; bugProject: string }) {
  return (
    <Card className="p-5">
      <StoriesSettings projectId={projectId} saved={stories ?? DEFAULT_STORIES} bugProject={bugProject} standalone />
    </Card>
  );
}

type TemplateCheck = {
  /** later: only on Jira's Edit screen, filled just after the bug is created. value: what every bug gets (Priority). */
  fields: { name: string; found: boolean; required: boolean; options: string[]; kind: string; later: boolean; value?: string }[];
  uncovered: string[];
  severitySet: boolean;
  guess: { clientTag: string; team: string; clients: string[] };
};

type Draft = { template: ImportedTemplate; exampleTitle: string; options: Record<string, { options: string[]; example: string[] }> };

const STEPS = [
  <>
    In Jira, open one bug that looks the way every bug should. <span className="text-slate-500">A real bug is fine. Only its layout is copied, not its words.</span>
  </>,
  <>Copy its key from the top of the page, or copy the link from your browser&apos;s address bar.</>,
  <>
    Paste it below and click <b className="font-semibold">Read template</b>.
  </>,
  <>Check what Flaw Patrol found, and change anything that looks wrong.</>,
  <>
    Click <b className="font-semibold">Save template</b>. New bugs from this test cycle use it.
  </>,
];

const titleShape = (t: { tag: boolean; feature: boolean }) => [t.tag && "[Tag]", t.feature && "Feature", "Summary"].filter(Boolean).join(" - ");

/**
 * Settings → Jira → Bug template: the plain layout, or a template imported by
 * pasting one example Jira bug (read, checked, saved). A detailed template set
 * up before imports shows as a saved one too, with its own defaults.
 */
function BugTemplateSettings({ projectId, saved, jiraProjectKey, standalone = false, shared = { choices: [], current: null } }: { projectId: string; saved: TemplateSettings; jiraProjectKey: string; standalone?: boolean; shared?: SharedView }) {
  const router = useRouter();
  const inUse = shared.current;
  // With a company template picked, `saved` is that layout; this place's own kind stays behind it.
  const kind = inUse ? "plain" : templateKind(saved);
  const [choice, setChoice] = useState<Choice>(inUse ? `shared:${inUse.id}` : kind === "plain" ? "plain" : kind === "detailed" ? "oko" : "import");
  const [stage, setStage] = useState<"paste" | "check" | "saved" | "detailed">(kind === "plain" && !inUse ? "paste" : "saved");
  const [example, setExample] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Import… on the umbrella's settings lands here with the import already picked.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const pick = () => {
      if (window.location.hash !== `#${IMPORT_HASH}`) return;
      setChoice("import");
      setStage("paste");
      // After the paste box has rendered.
      t = setTimeout(() => {
        document.getElementById(IMPORT_HASH)?.scrollIntoView({ block: "start" });
        document.getElementById("tpl-example")?.focus({ preventScroll: true });
      }, 50);
    };
    pick();
    // The umbrella's settings keep this form open, so Import… there changes only the hash.
    window.addEventListener("hashchange", pick);
    return () => {
      window.removeEventListener("hashchange", pick);
      clearTimeout(t);
    };
  }, []);
  const done = (message: string, next: typeof stage) => {
    setError(null);
    setOk(message);
    setStage(next);
    router.refresh();
  };
  const read = () =>
    start(async () => {
      setOk(null);
      const res = await readBugTemplate(projectId, example);
      if (!res.ok) return setError(res.error);
      setError(null);
      setDraft({ template: res.template, exampleTitle: res.exampleTitle, options: res.options });
      setStage("check");
    });
  const saveDraft = () =>
    draft &&
    start(async () => {
      const res = await saveImportedTemplate(projectId, draft.template);
      if (!res.ok) return setError(res.error);
      done(`Template saved from ${draft.template.from}. New bugs from this test cycle use it.`, "saved");
    });
  const plain = () =>
    start(async () => {
      const res = await setPlainLayout(projectId);
      if (!res.ok) return setError(res.error);
      done("Saved. New bugs use the plain layout.", "paste");
    });
  const setT = (fn: (t: ImportedTemplate) => ImportedTemplate) => setDraft((d) => (d ? { ...d, template: fn(d.template) } : d));
  const option = (value: Choice, title: React.ReactNode, text: string) => (
    <label className={choiceClass(choice === value)}>
      <input
        type="radio"
        name="bug-layout"
        checked={choice === value}
        onChange={() => {
          setChoice(value);
          setOk(null);
          if (value.startsWith("shared:")) setStage("saved");
          else if (value === "oko") setStage(kind === "detailed" ? "saved" : "detailed");
          else if (value === "import") setStage(kind === "imported" ? "saved" : "paste");
        }}
        className="mt-1"
      />
      <span>
        <span className="block font-medium text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </label>
  );
  const imp = saved.imported;
  // The company templates this email may pick, plus the one in use even when it isn't theirs.
  const sharedList = [...shared.choices.map((t) => ({ ...t, mine: true })), ...(inUse && !shared.choices.some((t) => t.id === inUse.id) ? [{ ...inUse, mine: false }] : [])];
  const picked = choice.startsWith("shared:") ? sharedList.find((t) => `shared:${t.id}` === choice) : undefined;
  const pickShared = (id: string | null) =>
    start(async () => {
      const res = await pickSharedTemplate(projectId, id);
      if (!res.ok) return setError(res.error);
      // The detailed layout fills a client tag and defaults from this place: set them next.
      done(id ? `Saved. New bugs from here use ${picked?.name ?? "the shared template"}.${picked?.kind === "detailed" ? " Check this place's defaults below." : ""}` : "Saved.", picked?.kind === "detailed" ? "detailed" : "saved");
    });
  return (
    <div id={IMPORT_HASH} className={`${standalone ? "" : "mt-5 border-t border-slate-100 pt-4"} scroll-mt-20 space-y-3 text-sm`} data-testid="bug-template-settings">
      <BugTemplateHeading tip="Paste a Jira bug that already uses your layout, and Flaw Patrol copies its sections and fields." />
      <div className="grid gap-2">
        {option("plain", "Plain layout", "Steps, expected and actual result, attachments. The tester writes the title.")}
        {/* The built-in OKO layout only where it's already in use; company templates replace it. */}
        {kind === "detailed" && option("oko", OKO_TITLE, "A ready-made layout with a Reproduction History table and a client tag in the title.")}
        {sharedList.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed border-accent-200 p-2" data-testid="shared-templates">
            <p className="flex items-center gap-1.5 px-1 text-xs font-semibold text-slate-600">
              Shared with you <InfoTip text="Bug templates a workspace admin shared with everyone whose email ends a certain way. Once picked, every bug from here uses it, whoever files it." />
            </p>
            {sharedList.map((t) => (
              <Fragment key={t.id}>
                {option(
                `shared:${t.id}`,
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {t.name}
                  <span className="rounded-full bg-accent-100 px-1.5 py-px text-[10px] font-semibold text-accent-800 uppercase">Shared</span>
                </span>,
                `${t.source} · title ${t.title}${t.mine ? "" : " · Shared with other emails, so once you switch away only they can pick it again."}`,
                )}
              </Fragment>
            ))}
          </div>
        )}
        {option("import", "Import a template from Jira", "Copy the layout of a bug your team already writes the right way.")}
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {ok && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{ok}</p>}

      {picked ? (
        inUse?.id === picked.id ? (
          stage === "detailed" ? (
            <DetailedTemplate projectId={projectId} saved={saved} jiraProjectKey={jiraProjectKey} keepShared onCancel={() => setStage("saved")} />
          ) : (
            <div className="space-y-2" data-testid="template-saved">
              {!ok && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{picked.name} on. Every bug from here uses it, whoever files it.</p>}
              <p className="text-xs font-medium text-slate-600">Title</p>
              <p className="rounded-md border border-slate-200 px-3 py-1.5 font-mono text-[13px] text-slate-800">{templateKind(saved) === "detailed" ? `${saved.clientTag ? `[${saved.clientTag}]` : "[Tag]"} - Feature - Brief summary` : picked.title}</p>
              {templateKind(saved) === "detailed" && (
                <Button size="sm" onClick={() => (setStage("detailed"), setOk(null))}>
                  Edit defaults
                </Button>
              )}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              {picked.source}. Title: <span className="font-mono">{picked.title}</span>. Fields are matched to this Jira project by name; any it doesn&apos;t have go into the description.
            </p>
            <Button variant="primary" size="sm" disabled={pending} onClick={() => pickShared(picked.id)}>
              {pending ? "Saving…" : `Use ${picked.name}`}
            </Button>
          </div>
        )
      ) : choice === "plain" ? (
        (kind !== "plain" || inUse) && (
          <Button variant="primary" size="sm" disabled={pending} onClick={plain}>
            {pending ? "Saving…" : "Use the plain layout"}
          </Button>
        )
      ) : choice === "oko" ? (
        stage === "saved" && kind === "detailed" ? (
          <div className="space-y-2" data-testid="template-saved">
            {!ok && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">OKO bug layout on. New bugs from this test cycle use it.</p>}
            <p className="text-xs font-medium text-slate-600">Title</p>
            <p className="rounded-md border border-slate-200 px-3 py-1.5 font-mono text-[13px] text-slate-800">{saved.clientTag ? `[${saved.clientTag}]` : "[Tag]"} - Feature - Brief summary</p>
            <Button size="sm" onClick={() => (setStage("detailed"), setOk(null))}>
              Edit defaults
            </Button>
          </div>
        ) : (
          <DetailedTemplate projectId={projectId} saved={saved} jiraProjectKey={jiraProjectKey} onCancel={kind === "detailed" ? () => setStage("saved") : undefined} />
        )
      ) : stage === "saved" && kind === "imported" ? (
        <div className="space-y-2" data-testid="template-saved">
          {!ok && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {imp ? `Template saved from ${imp.from}. New bugs from this test cycle use it.` : "Detailed template on. New bugs from this test cycle use it."}
            </p>
          )}
          <p className="text-xs font-medium text-slate-600">Title</p>
          <p className="rounded-md border border-slate-200 px-3 py-1.5 font-mono text-[13px] text-slate-800">{imp ? titleShape(imp.title) : "[Tag] - Feature - Brief summary"}</p>
          <p className="text-xs text-slate-500">
            {imp && `${imp.sections.filter((x) => x.source !== "empty").length} description sections · ${imp.fields.filter((f) => f.source !== "empty").length} Jira fields`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => (setStage("paste"), setOk(null))}>
              Import a different bug
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOk(null);
                if (!imp) return;
                setDraft({ template: imp, exampleTitle: "", options: {} });
                setStage("check");
              }}
            >
              Edit template
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <details open={!imp && stage === "paste"} className="rounded-lg border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-800">How to import your template</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-slate-700">
              {STEPS.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </details>
          {imp && kind !== "imported" && stage === "paste" && (
            <p className="text-xs text-slate-600">
              The template from {imp.from} is still saved.{" "}
              <button type="button" className="font-medium text-accent-700 hover:underline" disabled={pending} onClick={() => start(async () => {
                const res = await saveImportedTemplate(projectId, imp);
                if (!res.ok) return setError(res.error);
                done(`Template saved from ${imp.from}. New bugs from this test cycle use it.`, "saved");
              })}>
                Use it again
              </button>
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-64">
              <Field label="Example bug" htmlFor="tpl-example" hint={`Must be in Jira project ${jiraProjectKey}. Nothing is changed in Jira.`}>
                <Input
                  id="tpl-example"
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), read())}
                  placeholder="Jira key or link"
                />
              </Field>
            </div>
            <Button variant={stage === "check" ? "secondary" : "primary"} disabled={pending || !example.trim()} onClick={read} className="mb-5">
              {pending && stage !== "check" ? "Reading…" : stage === "check" && draft?.exampleTitle ? "Read again" : "Read template"}
            </Button>
          </div>
          {stage === "check" && draft && (
            <div className="space-y-4" data-testid="template-found">
              <div>
                <h4 className="text-[13px] font-semibold text-slate-800">Title</h4>
                {draft.exampleTitle && <p className="mb-1.5 text-xs text-slate-500">Found in the example: &ldquo;{draft.exampleTitle}&rdquo;</p>}
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  {(["tag", "feature"] as const).map((part) => (
                    <label key={part} className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 font-mono">
                      <input type="checkbox" checked={draft.template.title[part]} onChange={(e) => setT((t) => ({ ...t, title: { ...t.title, [part]: e.target.checked } }))} />
                      {part === "tag" ? "[Tag]" : "Feature"}
                    </label>
                  ))}
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono">Summary</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Tag and Feature are optional. Leave them blank on a bug and they&apos;re left out. With neither, the title is just what the tester types.</p>
              </div>
              <div>
                <h4 className="mb-1 text-[13px] font-semibold text-slate-800">Description sections</h4>
                {draft.template.sections.length ? (
                  <MapTable
                    head={["Heading in the example", "On each new bug"]}
                    rows={draft.template.sections.map((x, i) => ({
                      label: x.heading,
                      control: (
                        <Select
                          aria-label={`${x.heading} on each new bug`}
                          value={x.source}
                          onChange={(e) => setT((t) => ({ ...t, sections: t.sections.map((y, j) => (j === i ? { ...y, source: e.target.value as SectionSource } : y)) }))}
                        >
                          {Object.entries(SECTION_SOURCES).map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      ),
                    }))}
                  />
                ) : (
                  <p className="text-xs text-slate-500">No headings found in the example&apos;s description, so bugs get the plain description.</p>
                )}
              </div>
              <div>
                <h4 className="mb-1 text-[13px] font-semibold text-slate-800">Jira fields</h4>
                {draft.template.fields.length ? (
                  <MapTable
                    head={["Field", "On each new bug"]}
                    rows={draft.template.fields.map((f, i) => {
                      const set = (patch: Partial<ImportedTemplate["fields"][number]>) => setT((t) => ({ ...t, fields: t.fields.map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
                      const o = draft.options[f.id];
                      return {
                        label: `${f.name}${f.required ? " (required)" : ""}`,
                        control: (
                          <div className="flex flex-wrap gap-2">
                            <Select
                              aria-label={`${f.name} on each new bug`}
                              value={f.source}
                              className="w-auto"
                              onChange={(e) => {
                                const source = e.target.value as FieldSource;
                                set({ source, value: source === "default" && !f.value.length ? (o?.example ?? []) : f.value });
                              }}
                            >
                              {Object.entries(FIELD_SOURCES)
                                .filter(([v]) => !(f.required && v === "empty"))
                                .map(([v, label]) => (
                                  <option key={v} value={v}>
                                    {label}
                                  </option>
                                ))}
                            </Select>
                            {f.source === "default" &&
                              (o?.options.length ? (
                                <Select aria-label={`Default ${f.name}`} value={f.value[0] ?? ""} className="w-auto" onChange={(e) => set({ value: [e.target.value].filter(Boolean) })}>
                                  <option value="">Choose…</option>
                                  {[...o.options, ...f.value.filter((v) => !o.options.includes(v))].map((v) => (
                                    <option key={v}>{v}</option>
                                  ))}
                                </Select>
                              ) : (
                                <Input aria-label={`Default ${f.name}`} value={f.value.join(", ")} className="w-48" onChange={(e) => set({ value: e.target.value.split(/\s*,\s*/).filter(Boolean) })} />
                              ))}
                          </div>
                        ),
                      };
                    })}
                  />
                ) : (
                  <p className="text-xs text-slate-500">The example uses no extra Jira fields.</p>
                )}
                <p className="mt-1 text-xs text-slate-500">Only fields that had a value in the example are listed. Fields Jira requires are always included. Severity is always picked by the tester.</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => (setDraft(null), setStage(kind === "imported" ? "saved" : "paste"))}>Cancel</Button>
                <Button variant="primary" disabled={pending} onClick={saveDraft}>
                  {pending ? "Saving…" : "Save template"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <PrioritySettings projectId={projectId} />
    </div>
  );
}

type Choice = "plain" | "oko" | "import" | `shared:${string}`;
const IMPORT_HASH = "import-template";
const OKO_TITLE = (
  <span className="inline-flex items-center gap-1">
    OKO bug layout <span className="font-normal text-slate-500">(from OB-5292)</span>
    <InfoTip text="The layout from OB-5292: title [CLIENT(S)] - Feature - Summary, Severity A to E, Threads, a Reproduction History table, Repro Steps, OKO Space Link, Bug Impact and Bug Workaround, plus Client/SKUs, Team, Repro Rate, Build # and Oly Environment." />
  </span>
);

function BugTemplateHeading({ tip }: { tip: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        Bug template <InfoTip text={tip} />
      </h3>
      <p className="text-xs text-slate-500">How bugs filed from this test cycle are laid out in Jira.</p>
    </div>
  );
}

/** Before Jira is connected: the same choices, grayed, so people know where the import lives. */
function BugTemplateLocked({ standalone = false }: { standalone?: boolean }) {
  return (
    <div id={IMPORT_HASH} className={`${standalone ? "" : "mt-5 border-t border-slate-100 pt-4"} scroll-mt-20 space-y-3 text-sm opacity-60`} data-testid="bug-template-locked">
      <BugTemplateHeading tip={standalone ? "Paste the API token again in Jira connection first. Then you can pick or import a template." : "Connect Jira above first. Then you can import a template from an example bug."} />
      <div className="grid gap-2">
        {[
          ["Plain layout", "Steps, expected and actual result, attachments. The tester writes the title."],
          ["Import a template from Jira", "Copy the layout of a bug your team already writes the right way."],
        ].map(([title, text], i) => (
          <label key={i} className="flex cursor-not-allowed items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2">
            <input type="radio" name="bug-layout-locked" disabled defaultChecked={i === 0} className="mt-1" />
            <span>
              <span className="block font-medium text-slate-900">{title}</span>
              <span className="block text-xs text-slate-500">{text}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const choiceClass = (on: boolean) =>
  on ? "flex cursor-pointer items-start gap-2.5 rounded-lg border border-accent-500 bg-accent-50 px-3 py-2" : "flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-300";

function MapTable({ head, rows }: { head: [string, string]; rows: { label: string; control: React.ReactNode }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-slate-500 uppercase">
            <th className="px-3 py-2 font-semibold">{head[0]}</th>
            <th className="px-3 py-2 font-semibold">{head[1]}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-3 py-1.5 align-middle text-slate-800">{r.label}</td>
              <td className="px-3 py-1.5">{r.control}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The detailed template (Reproduction History layout): see which of its fields this Jira has, and set this test cycle's defaults. */
function DetailedTemplate({ projectId, saved, jiraProjectKey, onCancel, keepShared = false }: { projectId: string; saved: TemplateSettings; jiraProjectKey: string; onCancel?: () => void; keepShared?: boolean }) {
  const router = useRouter();
  const on = true;
  const [clientTag, setClientTag] = useState(saved.clientTag);
  const [team, setTeam] = useState(saved.team);
  const [clients, setClients] = useState(saved.clients);
  const [olyEnv, setOlyEnv] = useState(saved.olyEnv);
  const [check, setCheck] = useState<TemplateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [pending, start] = useTransition();
  const blank = !saved.clientTag && !saved.team && !saved.clients.length;
  useEffect(() => {
    if (!on) return;
    let live = true;
    setCheck(null);
    checkBugTemplate(projectId).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.error);
      setCheck(res);
      // Jira's own severity names were just picked up: show them everywhere.
      if (res.severitySet) router.refresh();
      // Nothing saved yet: start from what the project name suggests.
      if (blank) {
        setClientTag((v) => v || res.guess.clientTag);
        setTeam((v) => v || res.guess.team);
        setClients((v) => (v.length ? v : res.guess.clients));
      }
    });
    return () => {
      live = false;
    };
  }, [on, run, projectId, blank, router]);
  const opts = (name: string) => check?.fields.find((f) => f.name === name)?.options ?? [];
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chips = (label: string, options: string[], value: string[], set: (v: string[]) => void) => (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {[...options, ...value.filter((v) => !options.includes(v))].map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value.includes(o)}
          onClick={() => set(toggle(value, o))}
          className={
            value.includes(o)
              ? "rounded-full border border-accent-600 bg-accent-600 px-2.5 py-0.5 text-xs text-white"
              : "rounded-full border border-slate-300 bg-surface px-2.5 py-0.5 text-xs text-slate-700"
          }
        >
          {o}
        </button>
      ))}
      {!options.length && !value.length && <span className="text-xs text-slate-500">{check ? "No options found in Jira." : "Checking…"}</span>}
    </div>
  );
  const save = () =>
    start(async () => {
      setOk(null);
      const res = await saveBugTemplate(projectId, { on, clientTag, team, clients, olyEnv }, { keepShared });
      if (!res.ok) return setError(res.error);
      setError(null);
      setOk(keepShared ? "Saved. New bugs from here use these defaults." : "Saved. New bugs use the OKO bug layout.");
      router.refresh();
    });
  return (
    <div className="space-y-3" data-testid="detailed-template">
      <p className="text-xs text-slate-500">This layout adds a Reproduction History table and fills the extra Jira fields it finds.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {on && (
        <>
          <div>
            {!check ? (
              <p className="text-xs text-slate-500">Checking…</p>
            ) : (
              <div className="space-y-3" data-testid="template-fields">
                {(() => {
                  const filled = check.fields.filter((f) => f.found);
                  const written = check.fields.filter((f) => !f.found);
                  return (
                    <>
                      {filled.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-slate-600">Filled straight into Jira ({filled.length})</p>
                          <ul className="divide-y divide-slate-100" data-testid="fields-filled">
                            {filled.map((f) => (
                              <li key={f.name} className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-x-2 py-1.5 text-[13px] sm:grid-cols-[20px_minmax(0,170px)_minmax(0,1fr)]">
                                <Tick />
                                <span>{f.name}</span>
                                <span className="col-start-2 truncate text-slate-500 sm:col-start-auto">
                                  {[f.required && "required", f.value ?? (f.options.length ? `${f.options.length} options` : f.kind), f.later && "just after"].filter(Boolean).join(" · ")}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {filled.some((f) => f.later) && (
                            <p className="mt-1 text-xs text-slate-500" data-testid="fields-later">
                              Fields marked &quot;just after&quot; aren&apos;t on Jira&apos;s Create screen, so Flaw Patrol adds them a moment after the bug is created.
                            </p>
                          )}
                        </div>
                      )}
                      {written.length > 0 && (
                        <div>
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                            Written into the description ({written.length})
                            <InfoTip
                              text={`These fields aren't on the Create or Edit screen in Jira project ${jiraProjectKey}, so Flaw Patrol can't fill them directly. It writes them into the bug description instead, so nothing is lost. A Jira admin can add them to either screen, then press Check again.`}
                            />
                          </p>
                          <ul className="flex flex-wrap gap-1.5" data-testid="fields-written">
                            {written.map((f) => (
                              <li key={f.name} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12.5px] text-slate-700">
                                {f.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            {check && check.uncovered.length > 0 && (
              <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800" data-testid="fields-required">
                <Warn />
                <span className="flex-1">
                  Jira requires{" "}
                  {check.uncovered.map((n, i) => (
                    <span key={n}>
                      {i > 0 && (i === check.uncovered.length - 1 ? " and " : ", ")}
                      <b className="font-semibold">{n}</b>
                    </span>
                  ))}
                  , which this layout doesn&apos;t fill.
                </span>
                <InfoTip
                  text={`Jira may refuse new bugs until a Jira admin makes ${check.uncovered.length === 1 ? `${check.uncovered[0]} optional or gives it` : "these optional or gives them"} a default value.`}
                />
              </p>
            )}
            <Button size="sm" className="mt-3" onClick={() => setRun((n) => n + 1)}>
              Check again
            </Button>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-600">Defaults for this test cycle</p>
            <p className="text-xs text-slate-500">Filled in on every bug. Anyone filing can still change them on each bug.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title client tag" htmlFor="tpl-tag" hint="Shown in [brackets] at the start of each bug title. Leave blank for none.">
                <Input id="tpl-tag" value={clientTag} onChange={(e) => setClientTag(e.target.value.toUpperCase())} placeholder="Optional" />
              </Field>
              <Field label="Team" htmlFor="tpl-team">
                {opts("Team").length ? (
                  <Select id="tpl-team" value={team} onChange={(e) => setTeam(e.target.value)}>
                    <option value="">None</option>
                    {opts("Team").map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </Select>
                ) : (
                  <Input id="tpl-team" value={team} onChange={(e) => setTeam(e.target.value)} />
                )}
              </Field>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Client/SKUs</p>
              {chips("Default Client/SKUs", opts("Client/SKUs"), clients, setClients)}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Oly Environment (when the run&apos;s environment isn&apos;t one of these)</p>
              {chips("Default Oly Environment", opts("Oly Environment"), olyEnv, setOlyEnv)}
            </div>
            <p className="text-xs text-slate-500">Each test cycle keeps its own defaults, so each platform&apos;s bugs get the right client.</p>
          </div>
        </>
      )}
      {ok && <p className="text-sm text-emerald-700">{ok}</p>}
      <div className="flex flex-wrap gap-2">
        {onCancel && (
          <Button size="sm" onClick={onCancel}>
            Back
          </Button>
        )}
        <Button variant="primary" size="sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : saved.on && !saved.imported ? "Save defaults" : "Use the OKO bug layout"}
        </Button>
      </div>
    </div>
  );
}

type Check = { owner: string; canSet: boolean; total: number; missing: { name: string; email: string }[] };

const Tick = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-emerald-700">
    <path d="M5 12l5 5L20 7" />
  </svg>
);
const Warn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-amber-700">
    <path d="M12 8v5M12 16.5h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

/** Can each bug show the tester who filed it as its Reporter? */
function ReporterCheck({ projectId }: { projectId: string }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    checkJiraReporters(projectId).then((res) => {
      if (!live) return;
      if (res.ok) setCheck(res);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [projectId]);
  const found = check ? check.total - check.missing.length : 0;
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3 text-sm" data-testid="jira-reporter-check">
      <p className="text-xs font-semibold text-slate-600">Bug reporter</p>
      {error ? (
        <p className="text-xs text-slate-500">Couldn&apos;t check: {error}</p>
      ) : !check ? (
        <p className="text-xs text-slate-500">Checking…</p>
      ) : (
        <ul className="space-y-1.5">
          <li className="flex gap-2">
            {check.canSet ? <Tick /> : <Warn />}
            <span>
              {check.canSet
                ? `${check.owner}'s account can set the Reporter (has "Modify Reporter" in this Jira project).`
                : `${check.owner}'s account can't set the Reporter, so every bug will show ${check.owner}. A Jira admin needs to give this account the "Modify Reporter" permission in this Jira project.`}
            </span>
          </li>
          <li className="flex gap-2">
            {check.missing.length ? <Warn /> : <Tick />}
            <span>
              {found} of {check.total} members found in Jira by email.
            </span>
          </li>
          {check.missing.length > 0 && (
            <li className="flex gap-2">
              <Warn />
              <span>
                Not found:{" "}
                {check.missing.map((m, i) => (
                  <span key={m.email}>
                    {i > 0 && ", "}
                    <strong className="font-semibold">{m.name}</strong> ({m.email})
                  </span>
                ))}
                . Their bugs will show {check.owner} as reporter until they set a Jira email in Your account.
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Settings → Jira → Requirements: which Jira issues cases can link to. Uses the same Jira login. */
function StoriesSettings({ projectId, saved, bugProject, standalone = false }: { projectId: string; saved: StoriesConfig; bugProject: string; standalone?: boolean }) {
  const router = useRouter();
  const mode0 = saved.project === "*" ? "any" : saved.project && saved.project !== bugProject ? "other" : "same";
  const [mode, setMode] = useState<"same" | "other" | "any">(mode0);
  const [other, setOther] = useState(mode0 === "other" ? saved.project : "");
  const [types, setTypes] = useState<string[]>(saved.types);
  const [linkBugs, setLinkBugs] = useState(saved.linkBugs);
  const [rollUp, setRollUp] = useState(saved.rollUp);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  // The type list comes from the Jira project itself, so custom types like Requirement show up.
  const project = mode === "any" ? "*" : mode === "other" ? other.trim() : bugProject;
  const [jiraTypes, setJiraTypes] = useState<{ project: string; types: string[] } | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(
    async (key: string) => {
      if (!key) return;
      setLoading(true);
      const r = await loadIssueTypes(projectId, key);
      setLoading(false);
      if (r.ok) {
        setJiraTypes({ project: r.project, types: r.types });
        setTypesError(null);
      } else setTypesError(r.error);
    },
    [projectId],
  );
  useEffect(() => {
    const t = setTimeout(() => void reload(project), mode === "other" ? 600 : 0);
    return () => clearTimeout(t);
  }, [project, mode, reload]);
  // Jira's list, plus anything already ticked that Jira no longer lists, so nothing is dropped silently.
  const offered = [...new Set([...(jiraTypes?.types ?? (typesError ? STORY_TYPES : [])), ...types])];
  const save = () =>
    start(async () => {
      setOk(false);
      const res = await saveStoriesConfig(projectId, { project: mode === "any" ? "*" : mode === "other" ? other : "", types, linkBugs, rollUp });
      if (!res.ok) return setError(res.error);
      setError(null);
      setOk(true);
      router.refresh();
    });
  return (
    <section id="stories" className={`${standalone ? "" : "mt-6 border-t border-slate-200 pt-4"} scroll-mt-20 space-y-3`}>
      <h3 className="flex items-center gap-1 text-sm font-semibold text-slate-800">
        Requirements <InfoTip text={`Jira stories, Epics and other issues cases can link to. Coverage shows on the Requirements page and in Reports. Uses the Jira login ${standalone ? "in Jira connection" : "above"}.`} />
      </h3>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 text-xs font-medium text-slate-600">Requirement project</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="story-project" checked={mode === "same"} onChange={() => setMode("same")} /> Same as bugs ({bugProject})
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="story-project" checked={mode === "other"} onChange={() => setMode("other")} /> Another project
          {mode === "other" && <Input className="h-8 w-32" aria-label="Requirement project key" placeholder="PRJ" value={other} onChange={(e) => setOther(e.target.value.toUpperCase())} />}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="story-project" checked={mode === "any"} onChange={() => setMode("any")} /> Any project
          <InfoTip text="Search every Jira project the login can see. The Jira release list on the Requirements page needs one project, so it's hidden then." />
        </label>
      </fieldset>
      <fieldset className="text-sm">
        <legend className="mb-1 text-xs font-medium text-slate-600">Issue types you can link</legend>
        {offered.length ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {offered.map((t) => (
              <label key={t} className="flex items-center gap-1.5">
                <input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes((all) => (e.target.checked ? [...all, t] : all.filter((x) => x !== t)))} /> {t}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">{loading ? "Loading issue types from Jira…" : "Pick a project to see its issue types."}</p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          {typesError ? (
            <span className="text-orange-800">Couldn&apos;t load issue types from Jira: {typesError} Showing the usual ones.</span>
          ) : jiraTypes ? (
            <span>{jiraTypes.project === "*" ? "Loaded from Jira (every project)." : `Loaded from Jira project ${jiraTypes.project}.`}</span>
          ) : null}
          <button type="button" className="text-accent-700 hover:underline disabled:opacity-50" disabled={loading || !project} onClick={() => void reload(project)}>
            {loading ? "Loading…" : "Reload types"}
          </button>
        </p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={rollUp} onChange={(e) => setRollUp(e.target.checked)} /> Count an Epic&apos;s child issues toward the Epic
        <InfoTip text="An Epic also shows the cases linked to its child issues and adds up their results. One level down, not sub-tasks. Tick Epic above too." />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={linkBugs} onChange={(e) => setLinkBugs(e.target.checked)} /> Tick &quot;Link to requirement&quot; in the bug box by default
      </label>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="primary" disabled={pending || (mode === "other" && !other.trim())} onClick={save}>
          Save requirements
        </Button>
        <span role="status" className="text-xs text-emerald-700">
          {ok ? "Saved." : ""}
        </span>
      </div>
    </section>
  );
}

/**
 * Settings → Jira → Severity field: which Jira field holds severity, and which of its
 * values count as critical (they feed Critical bugs and Release status). None: the plain list.
 */
function SeveritySettings({ projectId, saved }: { projectId: string; saved: SeverityConfig | null }) {
  const router = useRouter();
  const [fields, setFields] = useState<{ id: string; name: string; values: string[] }[] | null>(null);
  const [fieldId, setFieldId] = useState<string>(saved?.fieldId ?? (saved ? "auto" : ""));
  const [critical, setCritical] = useState<string[]>(saved?.critical ?? []);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing || fields) return;
    jiraSeverityFields(projectId).then((res) => {
      if (!res.ok) return setError(res.error);
      setFields(res.fields);
      // A connection from before ver_91 found its field by name: point at it.
      if (fieldId === "auto") setFieldId(res.fields.find((f) => f.name.trim().toLowerCase() === (saved?.fieldName ?? "severity").toLowerCase())?.id ?? "");
    });
  }, [editing, fields, projectId, fieldId, saved]);
  const field = fields?.find((f) => f.id === fieldId);
  const values = field ? field.values.slice(0, SEVERITIES.length) : (saved?.values ?? []);
  const names = saved ? saved.values : SEVERITIES.filter((s) => PLAIN_SCALE.levels.includes(s)).map((s) => PLAIN_SCALE.labels[s]);
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3 text-sm" data-testid="jira-severity">
      <p className="flex items-center gap-1 text-xs font-semibold text-slate-600">
        Severity field
        <InfoTip text="Bugs get a severity from this Jira field's own values. The values you mark as critical count in Critical bugs and Release status." />
      </p>
      {!editing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span>
            {saved ? (
              <>
                {saved.fieldName} · {saved.values.length} values from Jira. Critical: {saved.critical.length ? saved.critical.join(", ") : "none"}.
              </>
            ) : (
              <>No Jira field. Bugs use {names.join(", ")}.</>
            )}
          </span>
          <Button size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {!fields && !error ? (
            <p className="text-xs text-slate-500">Reading the bug screen&apos;s fields from Jira…</p>
          ) : (
            <>
              <Field label="Which Jira field holds severity?" htmlFor="sev-field">
                <Select
                  id="sev-field"
                  value={fieldId === "auto" ? "" : fieldId}
                  onChange={(e) => {
                    setFieldId(e.target.value);
                    const f = fields?.find((x) => x.id === e.target.value);
                    setCritical(f ? f.values.slice(0, Math.min(2, f.values.length - 1)) : []);
                  }}
                  className="max-w-sm"
                >
                  <option value="">None: use Critical, Major, Minor and Trivial</option>
                  {fields?.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.values.length} values)
                    </option>
                  ))}
                </Select>
              </Field>
              {field && (
                <fieldset>
                  <legend className="mb-1 text-xs font-medium text-slate-700">Which values count as critical?</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {values.map((v) => (
                      <label key={v} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" className="accent-accent-600" checked={critical.includes(v)} onChange={() => setCritical((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]))} />
                        {v}
                      </label>
                    ))}
                  </div>
                  {field.values.length > SEVERITIES.length && <p className="mt-1 text-xs text-slate-500">Flaw Patrol uses the first {SEVERITIES.length} values.</p>}
                </fieldset>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await saveSeverityField(projectId, { fieldId: fieldId && fieldId !== "auto" ? fieldId : null, critical });
                      if (!res.ok) return setError(res.error);
                      setOk(true);
                      setEditing(false);
                      router.refresh();
                    })
                  }
                >
                  {pending ? "Saving…" : "Save severity"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {ok && !editing && <p className="text-xs text-emerald-700">Saved. Existing bugs keep their values.</p>}
    </div>
  );
}

type FoundInCheck = { onScreen: boolean; label: string; project: string; versions: string[] | null };

/**
 * Found-in version: put the release being tested into a Jira version field on new bugs.
 * One switch and one field pick; the check says whether Jira's create screen has the field.
 */
function FoundInSettings({ projectId, saved }: { projectId: string; saved: FoundInConfig | null }) {
  const router = useRouter();
  const [on, setOn] = useState(!!saved);
  const [field, setField] = useState<FoundInField>(saved?.field ?? "versions");
  const [check, setCheck] = useState<FoundInCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const dirty = on !== !!saved || (on && field !== (saved?.field ?? "versions"));
  useEffect(() => {
    if (!on) return;
    let live = true;
    setCheck(null);
    checkFoundIn(projectId, field).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.error);
      setCheck(res);
    });
    return () => {
      live = false;
    };
  }, [on, field, projectId]);
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3 text-sm" data-testid="jira-found-in">
      <p className="flex items-center gap-1 text-xs font-semibold text-slate-600">
        Found-in version
        <InfoTip text="New bugs get the release being tested as their Jira version. The release comes from the run's Release field. In a bug bash it's the bash's release. If neither has one, it's the test cycle's release name. Whoever files a bug can change it or leave it out." />
      </p>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Put the release being tested into new Jira bugs"
          onClick={() => {
            setOn(!on);
            setOk(false);
          }}
          className={cx("relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors", on ? "bg-accent-600" : "bg-slate-300")}
        >
          <span className={cx("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all", on ? "left-4" : "left-0.5")} />
        </button>
        <span className="text-sm text-slate-700">Put the release being tested into new Jira bugs</span>
      </div>
      {on && (
        <div className="space-y-2 pl-10">
          <Field label="Jira field" htmlFor="found-in-field">
            <Select
              id="found-in-field"
              value={field}
              onChange={(e) => {
                setField(e.target.value as FoundInField);
                setOk(false);
              }}
              className="w-auto min-w-64 max-w-full"
            >
              {(Object.keys(FOUND_IN_FIELDS) as FoundInField[]).map((f) => (
                <option key={f} value={f}>
                  {FOUND_IN_FIELDS[f].label} ({FOUND_IN_FIELDS[f].hint})
                </option>
              ))}
            </Select>
          </Field>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {!check && !error ? (
            <p className="text-xs text-slate-500">Checking Jira&apos;s create screen…</p>
          ) : check?.onScreen ? (
            <p className="text-xs text-emerald-700" data-testid="found-in-check">
              {check.project}&apos;s create screen has {check.label}.
              {check.versions && ` Jira has ${check.versions.length === 1 ? "1 version" : `${check.versions.length} versions`}${check.versions.length ? `: ${check.versions.slice(0, 8).join(", ")}${check.versions.length > 8 ? "…" : ""}` : ""}.`}
            </p>
          ) : check ? (
            <p className="text-xs text-amber-800" data-testid="found-in-check">
              {check.label} isn&apos;t on {check.project}&apos;s create screen, so the release goes in the description. A Jira admin can add the field to the screen.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            When the release isn&apos;t a version in Jira, the bug still gets filed, and the release name goes in the description. Release names match loosely: &quot;RC22&quot; and &quot;RC 22&quot; are the
            same version. Flaw Patrol never adds versions to Jira.
          </p>
        </div>
      )}
      {(dirty || pending) && (
        <Button
          size="sm"
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveFoundIn(projectId, { field: on ? field : null });
              if (!res.ok) return setError(res.error);
              setOk(true);
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save found-in version"}
        </Button>
      )}
      {ok && !dirty && <p className="text-xs text-emerald-700">{on ? "Saved. New bugs get a found-in version." : "Saved. New bugs don't get a found-in version."}</p>}
    </div>
  );
}

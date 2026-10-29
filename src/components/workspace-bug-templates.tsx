"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SharedListItem, ShareSources } from "@/lib/shared-template-data";
import { shareTemplate, stopSharing, updateSharedTemplate } from "@/server/shared-templates";
import { Modal } from "./modal";
import { MoreMenu } from "./more-menu";
import { Button, Card, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";

/** "@a.com, b.com" → ["a.com", "b.com"]; the server checks the rest. */
const splitDomains = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((d) => d.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);

/**
 * Workspace settings → Bug templates (ver_96): bug layouts shared with everyone whose email
 * ends a certain way. Each is one saved copy that umbrellas and test cycles point at.
 */
export function WorkspaceBugTemplates({ list, sources, joinDomains }: { list: SharedListItem[]; sources: ShareSources; joinDomains: string }) {
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState<SharedListItem | null>(null);
  return (
    <Card id="bug-templates" className="scroll-mt-20 p-5" data-testid="workspace-bug-templates">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          Shared bug templates <InfoTip text="A shared template shows up in the Bug template section of every umbrella and test cycle, for people whose email ends one of the ways you list. Edits here reach every place that uses it." />
        </h2>
        <Button size="sm" variant="primary" onClick={() => setSharing(true)}>
          + Share a template
        </Button>
      </div>
      <p className="mb-3 text-xs text-slate-500">Share a bug layout once, and your team can pick it in any umbrella or test cycle, new ones included.</p>
      {list.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">No shared templates yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start gap-3 px-3 py-3 text-sm">
              <span aria-hidden className="mt-0.5 text-lg">
                🐞
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-500">
                  {t.source} · title <span className="font-mono">{t.title}</span>
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Emails ending</span>
                  {t.domains.map((d) => (
                    <span key={d} className="rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-800 ring-1 ring-accent-200 ring-inset">
                      @{d}
                    </span>
                  ))}
                  <span className="ml-1 text-slate-500" title={t.usedIn.join(", ") || undefined}>
                    {t.usedIn.length ? `Used in ${t.usedIn.length} ${t.usedIn.length === 1 ? "place" : "places"}` : "Not used yet"}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => setEditing(t)}>
                  Edit…
                </Button>
                <MoreMenu label="⋯" title={`More for ${t.name}`}>
                  <Button variant="ghost" onClick={() => setEditing(t)}>
                    Rename
                  </Button>
                  <StopSharing item={t} />
                </MoreMenu>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={sharing} onClose={() => setSharing(false)} title="Share a template" wide>
        {sharing && <ShareForm sources={sources} joinDomains={joinDomains} onClose={() => setSharing(false)} />}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? ""}`}>
        {editing && <EditForm item={editing} onClose={() => setEditing(null)} />}
      </Modal>
    </Card>
  );
}

function StopSharing({ item }: { item: SharedListItem }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="text-red-700"
      disabled={pending}
      onClick={() => {
        const where = item.usedIn.length ? ` The ${item.usedIn.length === 1 ? "place" : `${item.usedIn.length} places`} using it keep their own copy.` : "";
        if (!confirm(`Stop sharing ${item.name}?${where}`)) return;
        start(async () => {
          const r = await stopSharing(item.id);
          if (!r.ok) alert(r.error);
          router.refresh();
        });
      }}
    >
      Stop sharing
    </Button>
  );
}

function DomainsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Who can use it" htmlFor="tpl-domains" hint="Email endings, separated by commas. People whose email ends one of these ways can pick it.">
      <Input id="tpl-domains" value={value} onChange={(e) => onChange(e.target.value)} placeholder="@yourcompany.com" />
    </Field>
  );
}

function ShareForm({ sources, joinDomains, onClose }: { sources: ShareSources; joinDomains: string; onClose: () => void }) {
  const router = useRouter();
  const [from, setFrom] = useState<"readymade" | "project" | "import">(sources.inUse.length ? "project" : "readymade");
  const [projectId, setProjectId] = useState(sources.inUse[0]?.id ?? "");
  const [jiraId, setJiraId] = useState(sources.jira[0]?.id ?? "");
  const [example, setExample] = useState("");
  const [name, setName] = useState("");
  // Starts with the endings already allowed to join under Sign-in.
  const [domains, setDomains] = useState(
    splitDomains(joinDomains)
      .map((d) => `@${d}`)
      .join(", "),
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(null);
      const r = await shareTemplate({
        name,
        domains: splitDomains(domains),
        from: from === "readymade" ? { kind: "readymade" } : from === "project" ? { kind: "project", projectId } : { kind: "import", projectId: jiraId, example },
      });
      if (!r.ok) return setError(r.error);
      setDone(`Shared. People with ${splitDomains(domains).map((d) => `@${d}`).join(" or ")} emails can pick it in any umbrella or test cycle.`);
      router.refresh();
    });
  if (done)
    return (
      <div className="space-y-4 text-sm">
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{done}</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  const opt = (id: typeof from, title: string, body: React.ReactNode, disabled = false) => (
    <label className={cx("flex items-start gap-2.5 rounded-lg border px-3 py-2", from === id ? "border-accent-500 bg-accent-50" : "border-slate-200", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <input type="radio" name="share-from" className="mt-1" checked={from === id} disabled={disabled} onChange={() => setFrom(id)} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-900">{title}</span>
        {from === id && body}
      </span>
    </label>
  );
  return (
    <div className="space-y-4 text-sm" data-testid="share-template">
      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium text-slate-700">Start from</legend>
        {opt("readymade", "The ready-made detailed layout", <span className="block text-xs text-slate-500">Title [Tag] - Feature - Summary, a Reproduction History table, and the extra Jira fields it finds.</span>)}
        {opt(
          "project",
          "A template already in use",
          <Select aria-label="Pick an umbrella or test cycle" className="mt-1.5" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {sources.inUse.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.title}
              </option>
            ))}
          </Select>,
          !sources.inUse.length,
        )}
        {opt(
          "import",
          "Import from a Jira bug",
          <span className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <Select aria-label="Read it through" value={jiraId} onChange={(e) => setJiraId(e.target.value)}>
              {sources.jira.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · Jira {p.jiraKey}
                </option>
              ))}
            </Select>
            <Input aria-label="Jira bug key or link" placeholder="Bug key or link, like QA-418" value={example} onChange={(e) => setExample(e.target.value)} />
          </span>,
          !sources.jira.length,
        )}
      </fieldset>
      <Field label="Name" htmlFor="tpl-name">
        <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Like Mobile crash report" />
      </Field>
      <DomainsField value={domains} onChange={setDomains} />
      {from === "project" && <p className="text-xs text-slate-500">The place it comes from switches to the shared copy, so it gets your later edits too.</p>}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !name.trim() || (from === "import" && !example.trim())} onClick={save}>
          {pending ? "Sharing…" : "Share template"}
        </Button>
      </div>
    </div>
  );
}

function EditForm({ item, onClose }: { item: SharedListItem; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(item.name);
  const [domains, setDomains] = useState(item.domains.map((d) => `@${d}`).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await updateSharedTemplate(item.id, { name, domains: splitDomains(domains) });
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });
  return (
    <div className="space-y-4 text-sm">
      <Field label="Name" htmlFor="tpl-edit-name">
        <Input id="tpl-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
      </Field>
      <DomainsField value={domains} onChange={setDomains} />
      <p className="text-xs text-slate-500">Places already using it keep it, even if their people's emails no longer match.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !name.trim()} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

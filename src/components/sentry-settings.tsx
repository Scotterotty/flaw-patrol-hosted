"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkSentry, disconnectSentry, saveSentry, sentryProjects } from "@/server/sentry";
import { Button, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";
import { useSpell } from "./spelling";

export type SentrySaved = {
  baseUrl: string;
  org: string;
  connectedAs: string;
  projects: { id: string; slug: string }[];
  environment: string;
  buildField: string;
  onlyTester: boolean;
  tokenReadable: boolean;
};

/**
 * Settings → Sentry (ver_96): Connect to Sentry in three steps. Sign in with a read-only
 * token, pick projects and an environment, then say how a run's build matches a release.
 */
export function SentryPanel({ projectId, saved, fields, canManage }: { projectId: string; saved: SentrySaved | null; fields: { id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const sp = useSpell();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(saved ? 0 : 1);
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "https://sentry.io");
  const [token, setToken] = useState("");
  const [orgs, setOrgs] = useState<{ slug: string; name: string }[]>(saved ? [{ slug: saved.org, name: saved.org }] : []);
  const [org, setOrg] = useState(saved?.org ?? "");
  const [as, setAs] = useState(saved?.connectedAs ?? "");
  const [projects, setProjects] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set(saved?.projects.map((p) => p.id) ?? []));
  const [envs, setEnvs] = useState<string[]>([]);
  const [environment, setEnvironment] = useState(saved?.environment ?? "");
  const [buildField, setBuildField] = useState(saved?.buildField ?? "build");
  const [onlyTester, setOnlyTester] = useState(saved?.onlyTester ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canManage)
    return <p className="text-sm text-slate-600">{saved ? `Connected to ${saved.org} (${saved.projects.map((p) => p.slug).join(", ")}).` : "Not connected. An admin can connect Sentry here."}</p>;

  if (step === 0 && saved)
    return (
      <div className="space-y-3 text-sm">
        <p className="text-slate-700">
          ✓ Connected to <strong>{saved.org}</strong>
          {saved.connectedAs && ` as ${saved.connectedAs}`} · {saved.projects.map((p) => p.slug).join(", ")}
          {saved.environment ? ` · ${saved.environment}` : " · any environment"}
        </p>
        {!saved.tokenReadable && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">This copy of Flaw Patrol can&apos;t read the saved token. Paste it again.</p>}
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setStep(1)}>
            Change
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await disconnectSentry(projectId);
                if (!r.ok) return setError(r.error);
                router.refresh();
              })
            }
          >
            Disconnect
          </Button>
        </div>
      </div>
    );

  const steps = ["Sign in", "Pick projects", "Match builds"];
  return (
    <div className="space-y-4 text-sm" data-testid="sentry-connect">
      <ol className="flex flex-wrap gap-3 text-xs">
        {steps.map((s, i) => (
          <li key={s} className={cx("flex items-center gap-1.5", step === i + 1 ? "font-semibold text-slate-900" : "text-slate-500")}>
            <span className={cx("grid size-5 place-items-center rounded-full text-[11px]", step > i + 1 ? "bg-emerald-600 text-white" : step === i + 1 ? "bg-accent-600 text-white" : "border border-slate-300")}>{step > i + 1 ? "✓" : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {step === 1 && (
        <>
          <Field label="Sentry address" htmlFor="sentry-base" hint="Change this only if your company runs its own Sentry.">
            <Input id="sentry-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
          <div>
            <label htmlFor="sentry-token" className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700">
              Sentry token
              <InfoTip text={sp("In Sentry: Settings → Developer Settings → Personal Tokens (or an internal integration). Give it Project, Issue & Event and Organization read.")} />
            </label>
            <Input id="sentry-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={saved ? "Leave blank to keep the saved token" : "sntrys_…"} />
            <p className="mt-1 text-xs text-slate-500">Read-only is enough. Stored locked, like the Jira token.</p>
          </div>
          {orgs.length > 0 && (
            <Field label={sp("Organization")} htmlFor="sentry-org">
              <Select id="sentry-org" value={org} onChange={(e) => setOrg(e.target.value)} className="w-auto min-w-64 max-w-full">
                {orgs.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {o.name === o.slug ? o.slug : `${o.name} (${o.slug})`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {as && <p className="text-emerald-700">✓ Connected as {as}</p>}
          <div className="flex gap-2">
            {orgs.length === 0 || !org ? (
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await checkSentry(projectId, { baseUrl, token });
                    if (!r.ok) return setError(r.error);
                    setOrgs(r.orgs);
                    setOrg(r.orgs[0].slug);
                    setAs(r.as ?? "");
                  })
                }
              >
                {pending ? "Checking…" : "Check token"}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await sentryProjects(projectId, { baseUrl, token, org });
                    if (!r.ok) return setError(r.error);
                    setProjects(r.projects);
                    setEnvs(r.environments);
                    if (!picked.size && r.projects.length === 1) setPicked(new Set([r.projects[0].id]));
                    setStep(2);
                  })
                }
              >
                Next
              </Button>
            )}
            {saved && <Button onClick={() => setStep(0)}>Cancel</Button>}
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Sentry projects</legend>
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => (
                <label key={p.id} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]", picked.has(p.id) ? "border-accent-500 bg-accent-50 text-accent-800" : "border-slate-200 text-slate-700")}>
                  <input
                    type="checkbox"
                    className="accent-accent-600"
                    checked={picked.has(p.id)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(p.id);
                        else n.delete(p.id);
                        return n;
                      })
                    }
                  />
                  {p.slug}
                </label>
              ))}
              {!projects.length && <span className="text-slate-500">No projects in {org}.</span>}
            </div>
          </fieldset>
          <Field label="Environment" htmlFor="sentry-env" hint="Only errors from this environment, like staging. Any shows them all.">
            <Select id="sentry-env" value={environment} onChange={(e) => setEnvironment(e.target.value)} className="w-auto min-w-56 max-w-full">
              <option value="">Any</option>
              {[...new Set([...envs, ...(environment ? [environment] : [])])].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!picked.size} onClick={() => setStep(3)}>
              Next
            </Button>
            <Button onClick={() => setStep(1)}>Back</Button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <fieldset>
            <legend className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700">
              Which run field holds the build?
              <InfoTip text="Flaw Patrol looks for the Sentry release whose name contains this value, like 4.12.0 (812) finding mobile-ios@4.12.0+812." />
            </legend>
            <div className="flex flex-wrap gap-2">
              {[{ id: "build", name: "Build" }, ...fields, { id: "", name: "Don't match builds, use time only" }].map((f) => (
                <label key={f.id || "time"} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]", buildField === f.id ? "border-accent-500 bg-accent-50 text-accent-800" : "border-slate-200 text-slate-700")}>
                  <input type="radio" name="sentry-build" className="accent-accent-600" checked={buildField === f.id} onChange={() => setBuildField(f.id)} />
                  {f.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Only show errors from the person testing?</legend>
            <div className="space-y-1">
              <label className="flex items-center gap-2">
                <input type="radio" name="sentry-who" className="accent-accent-600" checked={onlyTester} onChange={() => setOnlyTester(true)} />
                Yes, when Sentry knows their email
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="sentry-who" className="accent-accent-600" checked={!onlyTester} onChange={() => setOnlyTester(false)} />
                No, show everyone&apos;s errors
              </label>
            </div>
            <p className="mt-1 text-xs text-slate-500">Falls back to everyone&apos;s errors when the app doesn&apos;t send user emails to Sentry.</p>
          </fieldset>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await saveSentry(projectId, {
                    baseUrl,
                    token,
                    org,
                    as,
                    projects: projects.filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, slug: p.slug })),
                    environment,
                    buildField,
                    onlyTester,
                  });
                  if (!r.ok) return setError(r.error);
                  setStep(0);
                  setToken("");
                  router.refresh();
                })
              }
            >
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => setStep(2)}>Back</Button>
          </div>
        </>
      )}
    </div>
  );
}

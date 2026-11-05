"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { checkSignInProvider, removeSignInProvider, saveJoinDomains, saveSignInProvider, setPasswordSignIn, setProviderEnabled, testSignIn } from "@/server/workspace";
import { Badge, Button, Card, ErrorText, Input, InfoTip, TipField, cx } from "./ui";

export type ProviderView = {
  id: "microsoft" | "google" | "oidc";
  name: string;
  fromEnv: boolean;
  saved: {
    clientId: string;
    tenantId: string;
    issuer: string;
    label: string;
    hasSecret: boolean;
    secretReadable: boolean;
    secretExpires: string | null;
    joinDomains: string;
    enabled: boolean;
    testedAt: string | null;
    testedEmail: string | null;
  } | null;
};

const LOGO: Record<string, string> = { password: "@", microsoft: "M", google: "G", oidc: "⚿", github: "GH" };

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx("relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-accent-600" : "bg-slate-300")}
    >
      <span className={cx("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all", on ? "left-4" : "left-0.5")} />
    </button>
  );
}

function Row({ logo, title, status, right, children }: { logo: string; title: string; status: ReactNode; right: ReactNode; children?: ReactNode }) {
  return (
    <li className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-slate-100 text-xs font-semibold text-slate-700">
          {logo}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{status}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      </div>
      {children}
    </li>
  );
}

export function WorkspaceSignIn({
  password,
  providers,
  githubFromEnv,
  callbackBase,
  tested,
}: {
  password: { on: boolean; joinDomains: string; envDomains: string };
  providers: ProviderView[];
  githubFromEnv: boolean;
  callbackBase: string;
  tested: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.error ?? "Something went wrong."));
      router.refresh();
    });
  const working = providers.some((p) => p.saved?.enabled && p.saved.testedAt);

  return (
    <Card id="sign-in" data-howto="workspace-sign-in" className="scroll-mt-28 p-5" role="region" aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading" className="text-sm font-semibold text-slate-800">
        Sign-in
      </h2>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul className="mt-2">
        <Row
          logo={LOGO.password}
          title="Email and password"
          status={password.on ? "On" : "Off for everyone except workspace admins"}
          right={
            <>
              <InfoTip text="Can only be turned off once another way to sign in is on and tested, so nobody gets locked out. Workspace admins can always use Admin sign-in." />
              <Switch on={password.on} label="Email and password sign-in" disabled={pending || (password.on && !working)} onChange={(on) => run(() => setPasswordSignIn(on))} />
              <Button size="sm" onClick={() => setOpen(open === "password" ? null : "password")} aria-expanded={open === "password"}>
                Who can join
              </Button>
            </>
          }
        >
          {open === "password" && <PasswordJoin joinDomains={password.joinDomains} envDomains={password.envDomains} onDone={() => setOpen(null)} />}
        </Row>
        {providers.map((p) => (
          <ProviderRow key={p.id} p={p} open={open === p.id} setOpen={(o) => setOpen(o ? p.id : null)} callbackUrl={`${callbackBase}/api/auth/callback/${p.id}`} justTested={tested === p.id} />
        ))}
        {githubFromEnv && <Row logo={LOGO.github} title="GitHub" status="Set in the .env file" right={<InfoTip text="Settings in the .env file still work and win over this page, so nothing changes for copies already set up that way." />} />}
      </ul>
    </Card>
  );
}

function PasswordJoin({ joinDomains, envDomains, onDone }: { joinDomains: string; envDomains: string; onDone: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(joinDomains);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 ml-10 grid gap-2 rounded-lg border border-accent-500/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveJoinDomains(value);
          setError(res.ok ? null : res.error);
          if (res.ok) onDone();
          router.refresh();
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <TipField
        label="Anyone with an email at"
        htmlFor="join-domains"
        tip="People with these email domains can create a password account without being added first. They start with no umbrellas or test cycles until someone adds them. Leave empty so only people already added can sign in."
      >
        <Input id="join-domains" value={value} onChange={(e) => setValue(e.target.value)} placeholder="example.com" />
      </TipField>
      {envDomains && <p className="text-xs text-slate-500">Also from the .env file: {envDomains}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

function statusOf(p: ProviderView) {
  if (p.fromEnv) return "Set in the .env file";
  const s = p.saved;
  if (!s) return "Not set up";
  if (!s.secretReadable) return "The saved secret can't be read by this copy. Paste it again.";
  if (s.enabled) return `On${s.joinDomains ? ` · also anyone at ${s.joinDomains}` : ""}`;
  if (s.testedAt) return `Tested as ${s.testedEmail} · not on yet`;
  return "Saved · needs a test sign-in";
}

function expiresSoon(date: string | null) {
  if (!date) return null;
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days > 14) return null;
  return days < 0 ? "Secret expired" : `Secret expires in ${days} day${days === 1 ? "" : "s"}`;
}

function ProviderRow({ p, open, setOpen, callbackUrl, justTested }: { p: ProviderView; open: boolean; setOpen: (o: boolean) => void; callbackUrl: string; justTested: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const s = p.saved;
  const soon = expiresSoon(s?.secretExpires ?? null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.error ?? "Something went wrong."));
      setNote(res.ok ? (ok ?? null) : null);
      router.refresh();
    });

  if (p.fromEnv) return <Row logo={LOGO[p.id]} title={p.name} status={statusOf(p)} right={<InfoTip text="Settings in the .env file still work and win over this page, so nothing changes for copies already set up that way." />} />;

  return (
    <Row
      logo={LOGO[p.id]}
      title={p.id === "oidc" && s?.label ? `${p.name} (${s.label})` : p.name}
      status={
        <>
          {statusOf(p)}
          {soon && (
            <Badge tone="orange" className="ml-2">
              {soon}
            </Badge>
          )}
        </>
      }
      right={
        <>
          {s?.testedAt && <Switch on={s.enabled} label={`${p.name} sign-in`} disabled={pending} onChange={(on) => run(() => setProviderEnabled(p.id, on))} />}
          <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {s ? "Edit" : "Set up"}
          </Button>
        </>
      }
    >
      {justTested && s?.testedAt && !s.enabled && (
        <div role="status" className="mt-2 ml-10 flex flex-wrap items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✓ Test sign-in worked as {s.testedEmail}.
          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setProviderEnabled(p.id, true))}>
            Turn on
          </Button>
        </div>
      )}
      {open && <ProviderForm p={p} callbackUrl={callbackUrl} onClose={() => setOpen(false)} />}
      {error && (
        <div className="mt-2 ml-10">
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        </div>
      )}
      {open && s && (
        <div className="mt-2 ml-10 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => run(() => checkSignInProvider(p.id), `${p.name} answered. Now try Test sign-in.`)}>
            Check settings
          </Button>
          <form action={testSignIn.bind(null, p.id)}>
            <Button size="sm" type="submit" disabled={!s.secretReadable}>
              Test sign-in
            </Button>
          </form>
          <InfoTip text="Signs you in through it once, as yourself. Only workspace admins get through while it is off. It turns on only after a test works." />
          <span className="flex-1" />
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeSignInProvider(p.id))}>
            Remove
          </Button>
          {note && <span className="w-full text-xs text-emerald-700">{note}</span>}
        </div>
      )}
    </Row>
  );
}

const TIPS = {
  microsoft: {
    tenant: "In the Azure portal: Microsoft Entra ID → App registrations → your app → Overview.",
    client: "Same Overview page, just above the tenant ID.",
    secret: "Certificates & secrets → New client secret. Paste the Value, not the Secret ID. Stored encrypted, the same way as the Jira token, and never shown again.",
    redirect: "Add this under Authentication → Web → Redirect URIs. It follows the address people use to open Flaw Patrol, so add the new one when you move to hosting.",
  },
  google: {
    client: "Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application).",
    secret: "The client secret shown next to the client ID. Stored encrypted, the same way as the Jira token, and never shown again.",
    redirect: "Add this to the redirect URIs of the same OAuth client.",
  },
  oidc: {
    issuer: "The sign-in service's issuer URL, for example https://example.okta.com or https://example.auth0.com. Flaw Patrol reads the rest from it.",
    label: "The name on the sign-in button, like Okta or Company SSO.",
    client: "From the app you register for Flaw Patrol in your sign-in service (OpenID Connect, web app).",
    secret: "From the same app. Stored encrypted, the same way as the Jira token, and never shown again.",
    redirect: "Add this as the sign-in redirect URI (sometimes called callback URL) in that app.",
  },
} as const;

function ProviderForm({ p, callbackUrl, onClose }: { p: ProviderView; callbackUrl: string; onClose: () => void }) {
  const router = useRouter();
  const s = p.saved;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [domainsOn, setDomainsOn] = useState(!!s?.joinDomains);
  const tips = TIPS[p.id];
  const id = (f: string) => `${p.id}-${f}`;
  return (
    <form
      className="mt-3 ml-10 grid gap-3 rounded-lg border border-accent-500/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await saveSignInProvider(p.id, {
            clientId: String(fd.get("clientId") ?? ""),
            tenantId: String(fd.get("tenantId") ?? ""),
            issuer: String(fd.get("issuer") ?? ""),
            label: String(fd.get("label") ?? ""),
            secret: String(fd.get("secret") ?? ""),
            secretExpires: String(fd.get("secretExpires") ?? ""),
            joinDomains: domainsOn ? String(fd.get("joinDomains") ?? "") : "",
          });
          setError(res.ok ? null : res.error);
          router.refresh();
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="grid gap-3 sm:grid-cols-2">
        {p.id === "oidc" && (
          <>
            <TipField label="Issuer URL" htmlFor={id("issuer")} tip={TIPS.oidc.issuer}>
              <Input id={id("issuer")} name="issuer" defaultValue={s?.issuer} required placeholder="https://example.okta.com" />
            </TipField>
            <TipField label="Button name" htmlFor={id("label")} tip={TIPS.oidc.label}>
              <Input id={id("label")} name="label" defaultValue={s?.label} placeholder="Company SSO" maxLength={40} />
            </TipField>
          </>
        )}
        {p.id === "microsoft" && (
          <TipField label="Directory (tenant) ID" htmlFor={id("tenant")} tip={TIPS.microsoft.tenant}>
            <Input id={id("tenant")} name="tenantId" defaultValue={s?.tenantId} required className="font-mono" autoComplete="off" />
          </TipField>
        )}
        <TipField label={p.id === "microsoft" ? "Application (client) ID" : "Client ID"} htmlFor={id("client")} tip={tips.client}>
          <Input id={id("client")} name="clientId" defaultValue={s?.clientId} required className="font-mono" autoComplete="off" />
        </TipField>
        <TipField label="Client secret" htmlFor={id("secret")} tip={tips.secret}>
          <Input id={id("secret")} name="secret" type="password" autoComplete="off" required={!s?.hasSecret || !s.secretReadable} placeholder={s?.hasSecret && s.secretReadable ? "Saved · type to replace" : ""} />
        </TipField>
        <TipField label="Secret expires" htmlFor={id("expires")} tip="Optional. Workspace admins see a reminder 14 days before, so sign-in doesn't stop working without warning.">
          <Input id={id("expires")} name="secretExpires" type="date" defaultValue={s?.secretExpires?.slice(0, 10) ?? ""} />
        </TipField>
      </div>
      <TipField label={`Redirect URL to paste into ${p.id === "oidc" ? "your sign-in service" : p.name}`} htmlFor={id("redirect")} tip={tips.redirect}>
        <div className="flex gap-2">
          <Input id={id("redirect")} readOnly value={callbackUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            type="button"
            size="sm"
            onClick={() =>
              navigator.clipboard?.writeText(callbackUrl).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </TipField>
      <fieldset className="grid gap-1.5 text-sm">
        <legend className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
          Who can sign in with {p.id === "oidc" ? s?.label || "it" : p.name}
          <InfoTip text="People already added to Flaw Patrol are matched by email and keep their runs, bugs and settings. New people only get in when their email domain is listed. They start with no umbrellas or test cycles until someone adds them." />
        </legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="who" checked={!domainsOn} onChange={() => setDomainsOn(false)} className="accent-accent-600" />
          Only people already added to Flaw Patrol
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <input type="radio" name="who" checked={domainsOn} onChange={() => setDomainsOn(true)} className="accent-accent-600" />
            Also anyone with an email at
          </label>
          <Input name="joinDomains" aria-label="Email domains" defaultValue={s?.joinDomains} disabled={!domainsOn} placeholder="example.com" className="w-44" />
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

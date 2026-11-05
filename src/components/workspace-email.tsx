"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveMail, sendTestMail } from "@/server/workspace";
import { Button, Card, ErrorText, Input, Select, TipField } from "./ui";

type Mode = "off" | "microsoft365" | "google" | "smtp";
const PRESETS: Record<Exclude<Mode, "off">, { name: string; host: string; port: number; security: string }> = {
  microsoft365: { name: "Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls" },
  google: { name: "Google Workspace", host: "smtp.gmail.com", port: 587, security: "starttls" },
  smtp: { name: "Other mail server", host: "", port: 587, security: "starttls" },
};

export type MailView = { mode: Mode; host: string; port: number; security: string; user: string; hasPassword: boolean; passwordReadable: boolean; fromName: string; fromAddress: string };

export function WorkspaceEmail({ saved }: { saved: MailView }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [host, setHost] = useState(saved.host);
  const [port, setPort] = useState(String(saved.port));
  const [security, setSecurity] = useState(saved.security);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const values = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    return {
      mode,
      host,
      port: Number(port),
      security: security as "starttls",
      user: String(fd.get("user") ?? ""),
      password: String(fd.get("password") ?? ""),
      fromName: String(fd.get("fromName") ?? ""),
      fromAddress: String(fd.get("fromAddress") ?? ""),
    };
  };

  return (
    <Card id="email" data-howto="workspace-email" className="scroll-mt-28 p-5" role="region" aria-labelledby="email-heading">
      <h2 id="email-heading" className="text-sm font-semibold text-slate-800">
        Email
      </h2>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = values(e.currentTarget);
          start(async () => {
            const res = await saveMail(v);
            setError(res.ok ? null : res.error);
            setNote(res.ok ? "Saved" : null);
            router.refresh();
          });
        }}
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <TipField label="Send email through" htmlFor="mail-mode" tip="Picks the usual server and port for you. You can still change them. Off means invites are copied and sent by hand.">
          <Select
            id="mail-mode"
            value={mode}
            onChange={(e) => {
              const m = e.target.value as Mode;
              setMode(m);
              setNote(null);
              if (m !== "off" && m !== "smtp") {
                setHost(PRESETS[m].host);
                setPort(String(PRESETS[m].port));
                setSecurity(PRESETS[m].security);
              }
            }}
          >
            <option value="off">Off (copy invites by hand)</option>
            {Object.entries(PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.name}
              </option>
            ))}
          </Select>
        </TipField>
        {mode !== "off" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TipField label="Mail server" htmlFor="mail-host">
                <Input id="mail-host" value={host} onChange={(e) => setHost(e.target.value)} required placeholder="smtp.example.com" className="font-mono" />
              </TipField>
              <div className="grid grid-cols-[5rem_1fr] gap-2">
                <TipField label="Port" htmlFor="mail-port">
                  <Input id="mail-port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />
                </TipField>
                <TipField label="Security" htmlFor="mail-security">
                  <Select id="mail-security" value={security} onChange={(e) => setSecurity(e.target.value)}>
                    <option value="starttls">STARTTLS</option>
                    <option value="ssl">SSL/TLS</option>
                    <option value="none">None</option>
                  </Select>
                </TipField>
              </div>
              <TipField label="Username" htmlFor="mail-user" tip="Usually the mailbox the emails are sent from. Leave empty if your mail server doesn't ask for one.">
                <Input id="mail-user" name="user" defaultValue={saved.user} autoComplete="off" placeholder="qa-notify@example.com" />
              </TipField>
              <TipField label="Password" htmlFor="mail-password" tip="Use an app password or a service account. Stored encrypted, the same way as the Jira token, and never shown again.">
                <Input id="mail-password" name="password" type="password" autoComplete="new-password" placeholder={saved.hasPassword && saved.passwordReadable ? "Saved · type to replace" : ""} />
              </TipField>
              <TipField label="From name" htmlFor="mail-from-name">
                <Input id="mail-from-name" name="fromName" defaultValue={saved.fromName} />
              </TipField>
              <TipField label="From address" htmlFor="mail-from">
                <Input id="mail-from" name="fromAddress" type="email" defaultValue={saved.fromAddress} required placeholder="qa-notify@example.com" />
              </TipField>
            </div>
            {saved.hasPassword && !saved.passwordReadable && <p className="text-xs text-red-700">The saved password can&apos;t be read by this copy of Flaw Patrol. Type it again.</p>}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {mode !== "off" && (
            <Button
              disabled={pending}
              onClick={(e) => {
                const v = values(e.currentTarget.form!);
                setNote(null);
                start(async () => {
                  const res = await sendTestMail(v);
                  setError(res.ok ? null : res.error);
                  setNote(res.ok ? `✓ Sent to ${res.to}` : null);
                });
              }}
            >
              Send test email to me
            </Button>
          )}
          {note && (
            <span role="status" className="text-xs text-emerald-700">
              {note}
            </span>
          )}
          <span className="flex-1" />
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { signIn } from "@/auth";
import { KEEP_CHOICES, logActivity } from "@/lib/activity";
import { seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { MAIL_PRESETS, MAIL_SECURITY, sendMail } from "@/lib/mail";
import { requireUser } from "@/lib/session";
import { COMPANY_PROVIDERS, domainList, forgetSavedProviders, GUID, isComplete, microsoftAuthority, PROVIDER_NAME, type CompanyProvider } from "@/lib/sign-in-config";
import { assertOutbound, OutboundBlocked } from "@/lib/outbound";
import { attempt, UserError } from "./result";
import { requireWorkspaceAdmin } from "./admin-guard";

const providerId = z.enum(COMPANY_PROVIDERS);
const nameOf = (id: CompanyProvider, label?: string | null) => (id === "oidc" ? label || PROVIDER_NAME.oidc : PROVIDER_NAME[id]);

const domainsSchema = z
  .string()
  .max(500)
  .transform((s) => domainList(s))
  .refine((list) => list.every((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)), "Enter domains like example.com, separated by commas.")
  .transform((list) => list.join(", "));

const providerSchema = z.object({
  clientId: z.string().trim().min(1, "Enter the client ID.").max(300),
  tenantId: z.string().trim().max(100).default(""),
  issuer: z.string().trim().max(500).default(""),
  label: z.string().trim().max(40).default(""),
  secret: z.string().trim().max(1000).default(""),
  secretExpires: z.string().trim().default(""),
  joinDomains: domainsSchema.default(""),
});

function done() {
  forgetSavedProviders();
  revalidatePath("/workspace");
  revalidatePath("/signin");
}

/** Save a company sign-in. Changing who it talks to turns it off until an admin tests it again. */
export async function saveSignInProvider(id: string, input: z.input<typeof providerSchema>) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const pid = providerId.parse(id);
    const data = providerSchema.parse(input);
    if (pid === "microsoft" && !GUID.test(data.tenantId)) throw new UserError("Enter the directory (tenant) ID. It looks like 4f2a1c3e-0b7d-4e21-9a55-1d2f3c4b5a6e.");
    if (pid === "oidc" && !/^https:\/\/\S+$/.test(data.issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(data.issuer)) throw new UserError("Enter the issuer URL. It starts with https://.");
    if (pid === "oidc") await outboundOk(data.issuer.replace(/\/+$/, ""), "the sign-in service");
    const old = await db.signInProvider.findUnique({ where: { id: pid } });
    if (!data.secret && !old?.secretEncrypted) throw new UserError("Paste the client secret.");
    // The saved secret only goes to the service it was made for (backend team review H2).
    const newPlace = !!old && (old.issuer !== (pid === "oidc" ? data.issuer.replace(/\/+$/, "") : "") || old.tenantId !== (pid === "microsoft" ? data.tenantId.toLowerCase() : ""));
    if (!data.secret && newPlace) throw new UserError("You changed where sign-in goes, so paste the client secret again.");
    const expires = data.secretExpires ? new Date(`${data.secretExpires}T12:00:00Z`) : null;
    if (expires && Number.isNaN(expires.getTime())) throw new UserError("Pick a real date for when the secret expires.");
    const moved = !old || old.clientId !== data.clientId || old.tenantId !== data.tenantId || old.issuer !== data.issuer.replace(/\/+$/, "") || !!data.secret;
    const row = {
      clientId: data.clientId,
      tenantId: pid === "microsoft" ? data.tenantId.toLowerCase() : "",
      issuer: pid === "oidc" ? data.issuer.replace(/\/+$/, "") : "",
      label: pid === "oidc" ? data.label : "",
      secretExpires: expires,
      joinDomains: data.joinDomains,
      ...(data.secret && { secretEncrypted: seal(data.secret) }),
      ...(moved && { testedAt: null, testedEmail: null, enabled: false }),
    };
    await db.signInProvider.upsert({ where: { id: pid }, create: { id: pid, ...row }, update: row });
    if (moved && old?.enabled) await keepSomeoneAbleToSignIn();
    await logActivity({
      actor: admin,
      kind: "settings",
      action: `${old ? "Changed" : "Set up"} ${nameOf(pid, data.label)} sign-in`,
      detail: [data.secret && (old ? "Secret replaced" : "Secret saved"), data.joinDomains && `Domain ${data.joinDomains}`, moved && old?.enabled && "Turned off until tested again"].filter(Boolean).join(" · "),
    });
    done();
    return { needsTest: moved };
  });
}

/** If the last company sign-in went off while email and password was off, turn email and password back on. */
async function keepSomeoneAbleToSignIn() {
  const ws = await db.workspace.findUnique({ where: { id: 1 } });
  if (ws?.passwordSignIn !== false) return;
  const on = await db.signInProvider.count({ where: { enabled: true } });
  if (!on) await db.workspace.update({ where: { id: 1 }, data: { passwordSignIn: true } });
}

/** Company sign-in addresses must be public (no cluster-internal addresses), unless IT allowed them. */
async function outboundOk(url: string, service: string) {
  try {
    await assertOutbound(url, service);
  } catch (e) {
    if (e instanceof OutboundBlocked) throw new UserError(e.message);
    throw e;
  }
}

/** Ask the sign-in service for its settings, so a wrong tenant ID or issuer shows up before anyone tries it. */
export async function checkSignInProvider(id: string) {
  return attempt(async () => {
    await requireWorkspaceAdmin();
    const pid = providerId.parse(id);
    const row = await db.signInProvider.findUnique({ where: { id: pid } });
    if (!row || !isComplete(row)) throw new UserError("Save the settings first.");
    const issuer = pid === "microsoft" ? `${microsoftAuthority()}/${row.tenantId}/v2.0` : pid === "google" ? "https://accounts.google.com" : row.issuer;
    await outboundOk(issuer, pid === "microsoft" ? "Microsoft sign-in" : "the sign-in service");
    let res: Response;
    try {
      res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "manual" });
    } catch {
      throw new UserError(`Couldn't reach ${new URL(issuer).host}. Check the address, and that this computer can reach it.`);
    }
    if (!res.ok) throw new UserError(pid === "microsoft" ? "Microsoft doesn't know that directory (tenant) ID." : "That issuer URL didn't answer like a sign-in service.");
    return {};
  });
}

/** Start an admin's test sign-in; it lands back on Workspace settings. */
export async function testSignIn(id: string) {
  const admin = await requireUser();
  if (!admin.isAdmin) return;
  const pid = providerId.parse(id);
  await signIn(pid, { redirectTo: `/workspace?tested=${pid}#sign-in` });
}

export async function setProviderEnabled(id: string, on: boolean) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const pid = providerId.parse(id);
    const row = await db.signInProvider.findUnique({ where: { id: pid } });
    if (!row) throw new UserError("Set it up first.");
    if (on && !row.testedAt) throw new UserError("Use Test sign-in first, so you know it works before everyone sees the button.");
    await db.signInProvider.update({ where: { id: pid }, data: { enabled: on } });
    if (!on) await keepSomeoneAbleToSignIn();
    await logActivity({ actor: admin, kind: "settings", action: `Turned ${on ? "on" : "off"} ${nameOf(pid, row.label)} sign-in`, detail: on && row.joinDomains ? `Domain ${row.joinDomains}` : "" });
    done();
    return {};
  });
}

export async function removeSignInProvider(id: string) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const pid = providerId.parse(id);
    const row = await db.signInProvider.findUnique({ where: { id: pid } });
    if (!row) return {};
    await db.signInProvider.delete({ where: { id: pid } });
    await keepSomeoneAbleToSignIn();
    await logActivity({ actor: admin, kind: "settings", action: `Removed ${nameOf(pid, row.label)} sign-in` });
    done();
    return {};
  });
}

export async function setPasswordSignIn(on: boolean) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    if (!on) {
      const working = await db.signInProvider.count({ where: { enabled: true, testedAt: { not: null } } });
      if (!working) throw new UserError("Turn on another way to sign in first, so nobody gets locked out.");
    }
    await db.workspace.upsert({ where: { id: 1 }, create: { id: 1, passwordSignIn: on }, update: { passwordSignIn: on } });
    await logActivity({ actor: admin, kind: "settings", action: `Turned ${on ? "on" : "off"} email and password sign-in` });
    done();
    return {};
  });
}

export async function saveJoinDomains(text: string) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const joinDomains = domainsSchema.parse(text);
    await db.workspace.upsert({ where: { id: 1 }, create: { id: 1, joinDomains }, update: { joinDomains } });
    await logActivity({ actor: admin, kind: "settings", action: "Changed who can create a password account", detail: joinDomains ? `Domain ${joinDomains}` : "Only people already added" });
    done();
    return {};
  });
}

const mailSchema = z.object({
  mode: z.enum(["off", ...(Object.keys(MAIL_PRESETS) as (keyof typeof MAIL_PRESETS)[])]),
  host: z.string().trim().max(200).default(""),
  port: z.coerce.number().int().min(1, "Enter a port between 1 and 65535.").max(65535, "Enter a port between 1 and 65535.").default(587),
  security: z.enum(Object.keys(MAIL_SECURITY) as [keyof typeof MAIL_SECURITY]),
  user: z.string().trim().max(200).default(""),
  password: z.string().max(500).default(""),
  fromName: z.string().trim().max(80).default("Flaw Patrol"),
  fromAddress: z.string().trim().max(200).default(""),
});

function mailRow(data: z.output<typeof mailSchema>, oldPass: string | null | undefined) {
  if (data.mode !== "off") {
    if (!/^[a-z0-9.-]+$/i.test(data.host)) throw new UserError("Enter the mail server's name, like smtp.example.com.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.fromAddress)) throw new UserError("Enter the From address, like qa-notify@example.com.");
  }
  return {
    mailMode: data.mode,
    mailHost: data.host,
    mailPort: data.port,
    mailSecurity: data.security,
    mailUser: data.user,
    mailFromName: data.fromName || "Flaw Patrol",
    mailFromAddress: data.fromAddress,
    mailPassEncrypted: data.password ? seal(data.password) : data.user ? (oldPass ?? null) : null,
  };
}

export async function saveMail(input: z.input<typeof mailSchema>) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const data = mailSchema.parse(input);
    const old = await db.workspace.findUnique({ where: { id: 1 } });
    const row = mailRow(data, old?.mailPassEncrypted);
    await db.workspace.upsert({ where: { id: 1 }, create: { id: 1, ...row }, update: row });
    await logActivity({
      actor: admin,
      kind: "settings",
      action: data.mode === "off" ? "Turned off invite emails" : old?.mailMode === "off" || !old ? "Set up email" : "Changed email settings",
      detail: data.mode === "off" ? "" : [`${data.host}:${data.port}`, data.password && "Password replaced"].filter(Boolean).join(" · "),
    });
    revalidatePath("/workspace");
    revalidatePath("/", "layout");
    return {};
  });
}

/** Send a test email to yourself with what's in the form (the saved password is used if none is typed). */
export async function sendTestMail(input: z.input<typeof mailSchema>) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const data = mailSchema.parse(input);
    if (data.mode === "off") throw new UserError("Pick how to send email first.");
    const old = await db.workspace.findUnique({ where: { id: 1 } });
    const row = mailRow(data, old?.mailPassEncrypted);
    try {
      await sendMail(
        { to: admin.email, subject: "Flaw Patrol test email", lines: ["This is a test from Flaw Patrol.", "Invite emails will come from this address."] },
        { mailMode: row.mailMode, mailHost: row.mailHost, mailPort: row.mailPort, mailSecurity: row.mailSecurity, mailUser: row.mailUser, mailPassEncrypted: row.mailPassEncrypted, mailFromName: row.mailFromName, mailFromAddress: row.mailFromAddress },
      );
    } catch (e) {
      throw new UserError((e as Error).message);
    }
    return { to: admin.email };
  });
}

export async function setActivityKeep(days: number) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const choice = KEEP_CHOICES.find(([d]) => d === days);
    if (!choice) throw new UserError("Pick how long to keep entries.");
    await db.workspace.upsert({ where: { id: 1 }, create: { id: 1, activityKeepDays: days }, update: { activityKeepDays: days } });
    await logActivity({ actor: admin, kind: "settings", action: "Changed how long the activity log keeps entries", detail: choice[1] });
    revalidatePath("/workspace");
    return {};
  });
}

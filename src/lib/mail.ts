import "server-only";
import type { Workspace } from "@prisma/client";
import nodemailer from "nodemailer";
import { canOpen, open } from "./crypto";
import { db } from "./db";
import { renderMail, type Mail } from "./mail-render";

export { renderMail, type Mail };

// Workspace settings → Email. Each company points Flaw Patrol at its own
// mail server; until then mailMode is "off" and invites are copied by hand.

export const MAIL_PRESETS = {
  microsoft365: { name: "Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls" },
  google: { name: "Google Workspace", host: "smtp.gmail.com", port: 587, security: "starttls" },
  smtp: { name: "Other mail server", host: "", port: 587, security: "starttls" },
} as const;
export type MailMode = keyof typeof MAIL_PRESETS | "off";
export const MAIL_SECURITY = { starttls: "STARTTLS", ssl: "SSL/TLS", none: "None" } as const;

type MailSettings = Pick<Workspace, "mailMode" | "mailHost" | "mailPort" | "mailSecurity" | "mailUser" | "mailPassEncrypted" | "mailFromName" | "mailFromAddress">;

export async function mailSettings(): Promise<MailSettings | null> {
  const ws = await db.workspace.findUnique({ where: { id: 1 } }).catch(() => null);
  return ws;
}

/** Email is set up and its password can be read by this copy. */
export function mailReady(ws: MailSettings | null): ws is MailSettings {
  if (!ws || ws.mailMode === "off" || !ws.mailHost || !ws.mailFromAddress) return false;
  return !ws.mailPassEncrypted || canOpen(ws.mailPassEncrypted);
}

export async function mailOn() {
  return mailReady(await mailSettings());
}

function transport(ws: MailSettings) {
  return nodemailer.createTransport({
    host: ws.mailHost,
    port: ws.mailPort,
    secure: ws.mailSecurity === "ssl",
    requireTLS: ws.mailSecurity === "starttls",
    ignoreTLS: ws.mailSecurity === "none",
    auth: ws.mailUser ? { user: ws.mailUser, pass: ws.mailPassEncrypted ? open(ws.mailPassEncrypted) : "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    // Plain text only from our own templates; never read files or URLs into a message.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/** Send one email with the saved settings (or ones being tested). Throws a readable message on failure. */
export async function sendMail(m: Mail, settings?: MailSettings) {
  const ws = settings ?? (await mailSettings());
  if (!mailReady(ws)) throw new Error("Email isn't set up. An admin can set it up in Workspace settings → Email.");
  const { text, html } = renderMail(m);
  try {
    await transport(ws).sendMail({ from: { name: ws.mailFromName || "Flaw Patrol", address: ws.mailFromAddress }, to: m.to, subject: m.subject, text, html });
  } catch (e) {
    throw new Error(mailError(e));
  }
}

/** Turn a mail server error into a sentence an admin can act on. */
export function mailError(e: unknown) {
  const err = e as { code?: string; responseCode?: number; message?: string };
  if (err.code === "EAUTH" || err.responseCode === 535) return "The mail server didn't accept the username or password.";
  if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "EDNS") return "Couldn't reach the mail server. Check the server name and port.";
  if (err.code === "ETIMEDOUT" || err.code === "ESOCKET") return "The mail server didn't answer. Check the port and security setting.";
  if (err.responseCode === 550 || err.responseCode === 553) return "The mail server refused that From address or recipient.";
  return `The mail server said: ${(err.message ?? "unknown error").slice(0, 200)}`;
}

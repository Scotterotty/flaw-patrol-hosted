import "server-only";
import type { Role } from "@prisma/client";
import { headers } from "next/headers";
import { db } from "./db";
import { mailOn, sendMail } from "./mail";
import { newLinkToken } from "./password";
import { ROLE_LABEL } from "./permissions";
import { signInButtons } from "./sign-in-config";

// Invite links (ver_92): one-time, 7 days, so a new person lands on a page made
// for them. Emailed when Workspace settings → Email is set up, else copied by hand.

export const INVITE_DAYS = 7;
export const RESET_HOURS = 24;

export async function appOrigin() {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** A fresh link replaces any earlier unused one of the same kind. */
export async function newLink(userId: string, kind: "invite" | "reset", createdById: string) {
  const { token, tokenHash } = newLinkToken();
  const ms = kind === "invite" ? INVITE_DAYS * 86_400_000 : RESET_HOURS * 3_600_000;
  const [, link] = await db.$transaction([
    db.passwordLink.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } }),
    db.passwordLink.create({ data: { userId, kind, tokenHash, expiresAt: new Date(Date.now() + ms), createdById } }),
  ]);
  return { id: link.id, url: `${await appOrigin()}/${kind === "invite" ? "invite" : "reset"}/${token}` };
}

/** The name people know the place by: the umbrella for its team, else the test cycle. */
export async function placeName(projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { name: true, hubOf: { select: { name: true } } } });
  return p?.hubOf?.name ?? p?.name ?? "Flaw Patrol";
}

async function ssoLine(email: string) {
  const buttons = (await signInButtons()).filter((b) => b.id !== "github");
  return buttons.length ? `Sign in with ${buttons.map((b) => b.name).join(" or ")} using ${email}, or choose a password.` : `Choose a password for ${email}.`;
}

/**
 * Email someone that they were added. People who never signed in get a one-time
 * invite link; people who already use Flaw Patrol get the sign-in address.
 */
export async function emailInvite(input: { projectId: string; user: { id: string; email: string; lastLoginAt: Date | null; passwordSetAt: Date | null }; role: Role; by: { id: string; name: string | null; email: string } }) {
  const place = await placeName(input.projectId);
  const who = input.by.name ?? input.by.email;
  const fresh = !input.user.lastLoginAt && !input.user.passwordSetAt;
  if (fresh) {
    const link = await newLink(input.user.id, "invite", input.by.id);
    await sendMail({
      to: input.user.email,
      subject: `${who} invited you to Flaw Patrol`,
      lines: [`${who} added you to ${place} as a ${ROLE_LABEL[input.role]}.`],
      button: { label: "Accept invite", url: link.url },
      footer: `${await ssoLine(input.user.email)} This link works once and expires in ${INVITE_DAYS} days.`,
    });
    await db.passwordLink.update({ where: { id: link.id }, data: { emailedAt: new Date() } });
  } else {
    await sendMail({
      to: input.user.email,
      subject: `${who} added you to ${place} in Flaw Patrol`,
      lines: [`${who} added you to ${place} as a ${ROLE_LABEL[input.role]}.`],
      button: { label: "Open Flaw Patrol", url: `${await appOrigin()}/signin?email=${encodeURIComponent(input.user.email)}` },
    });
  }
}

export { mailOn };

/** When each person's latest invite email went out, for "Invited · email sent 2 min ago". */
export async function inviteEmails(userIds: string[]) {
  const rows = await db.passwordLink.findMany({ where: { userId: { in: userIds }, kind: "invite", emailedAt: { not: null } }, select: { userId: true, emailedAt: true }, orderBy: { emailedAt: "asc" } });
  return new Map(rows.map((r) => [r.userId, r.emailedAt!]));
}

/** What the Members list needs to offer email: whether it's set up, and when invites went out. */
export async function memberInviteInfo(userIds: string[]) {
  const [canEmail, sent] = await Promise.all([mailOn(), inviteEmails(userIds)]);
  return { canEmail, sent };
}

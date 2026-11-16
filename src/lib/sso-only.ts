// Company sign-in only (hosted build, backend team review item 7). Set by IT on the server,
// not on a page, so nobody in the app can turn passwords back on:
//
//   AUTH_SSO_ONLY=true        No email and password for anyone, admins included: no password
//                             form, no Admin sign-in link, no password or invite links.
//   AUTH_ADMIN_EMAILS=a@x,b@x Workspace admins, made admin when they sign in. With this set,
//                             the first person to sign in no longer becomes admin by default.
//   AUTH_MICROSOFT_TENANT_ID, AUTH_MICROSOFT_ID, AUTH_MICROSOFT_SECRET
//                             Microsoft sign-in from the server's settings (Vault), so it works
//                             before anyone has signed in to set it up on Workspace settings.

const yes = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

/** Company sign-in only: no passwords for anyone. */
export const ssoOnly = () => yes(process.env.AUTH_SSO_ONLY);

/** Workspace admins named on the server, lower case. */
export function adminEmails(env: string | undefined = process.env.AUTH_ADMIN_EMAILS): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)),
  );
}

/** Microsoft sign-in set on the server, or null. */
export function envMicrosoft(): { tenantId: string; clientId: string; clientSecret: string } | null {
  const tenantId = process.env.AUTH_MICROSOFT_TENANT_ID?.trim();
  const clientId = process.env.AUTH_MICROSOFT_ID?.trim();
  const clientSecret = process.env.AUTH_MICROSOFT_SECRET?.trim();
  return tenantId && clientId && clientSecret ? { tenantId: tenantId.toLowerCase(), clientId, clientSecret } : null;
}

/** The plain words shown wherever a password feature is switched off by the server. */
export const SSO_ONLY_MESSAGE = "This server uses company sign-in only, so there are no passwords.";

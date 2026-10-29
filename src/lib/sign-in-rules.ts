// Pure rules for company sign-in (ver_92), kept apart from the database so they can be tested.

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Profile = { sub?: string; name?: string; email?: string; preferred_username?: string; email_verified?: boolean | string };

export function domainList(text: string | null | undefined) {
  return (text ?? "")
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export const emailInDomains = (email: string, domains: string[]) => domains.some((d) => email.toLowerCase().endsWith("@" + d));

/** Whether a profile's email can be trusted to match an existing account. */
export function emailTrusted(providerId: string, profile: Profile | undefined) {
  if (!profile) return true;
  // Google and most single sign-ons say so; Microsoft work accounts are managed by the company's own directory.
  if (profile.email_verified === false || profile.email_verified === "false") return false;
  if (providerId === "google") return profile.email_verified === true || profile.email_verified === "true";
  return true;
}

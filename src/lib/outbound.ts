import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Addresses Flaw Patrol's server may call when a person types them in (Jira, Sentry,
// TeamCity, company sign-in). Backend team review H2: inside a cluster, a typed-in address
// like 169.254.169.254 or something.svc.cluster.local would let anyone with a settings page
// make the server call internal services. So these calls go only to public addresses, over
// https, and never follow redirects (each client uses redirect: "manual").
//
// IT can let specific internal hosts through (a TeamCity or Jira inside the company network)
// with OUTBOUND_ALLOW_HOSTS, a comma-separated list of host names or IP addresses.
//
// The check resolves the name just before each call. A name that changes its answer between
// the check and the call (DNS rebinding) could still slip through; the cluster's egress
// policy is the second line for that.

export class OutboundBlocked extends Error {}

/** Hosts IT allowed with OUTBOUND_ALLOW_HOSTS, lower case. */
export function allowedHosts(env: string | undefined = process.env.OUTBOUND_ALLOW_HOSTS): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, ""))
      .filter(Boolean),
  );
}

const v4 = (ip: string) => ip.split(".").map(Number);

function blockedV4(ip: string): boolean {
  const [a, b, c] = v4(ip);
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT, also used inside clouds
    (a === 169 && b === 254) || // link-local, cloud metadata servers
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expand an IPv6 address to its 8 groups. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = v4(dotted[1]);
    s = s.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(fill).fill("0"), ...t];
  if (parts.length !== 8) return null;
  return parts.map((p) => parseInt(p, 16));
}

function blockedV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g || g.some((n) => Number.isNaN(n))) return true;
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return blockedV4(embeddedV4()); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return blockedV4(embeddedV4()); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True for loopback, private, link-local, cloud-metadata and other non-public addresses. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blockedV4(ip);
  if (kind === 6) return blockedV6(ip);
  return true;
}

/** Names that only mean something inside a network, whatever they resolve to. */
const INTERNAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|svc|cluster\.local)$/i;

const cache = new Map<string, { ok: boolean; at: number }>();
const CACHE_MS = 60_000;

/**
 * Throws OutboundBlocked (with a plain message naming the service) unless `url` is an https
 * address on the public internet, or its host is in OUTBOUND_ALLOW_HOSTS.
 * Outside production, http://localhost and 127.0.0.1 are allowed too, for the test stand-ins.
 */
export async function assertOutbound(
  url: string,
  service: string,
  opts: { allow?: Set<string>; production?: boolean; resolve?: (host: string) => Promise<string[]> } = {},
): Promise<URL> {
  const allow = opts.allow ?? allowedHosts();
  const production = opts.production ?? process.env.NODE_ENV === "production";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new OutboundBlocked(`That ${service} address isn't a web address. Type it like https://example.com.`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new OutboundBlocked(`The ${service} address must start with https://.`);
  if (u.username || u.password) throw new OutboundBlocked(`Take the name and password out of the ${service} address.`);
  if (allow.has(host) || allow.has(u.host.toLowerCase())) return u;
  if (!production && (host === "localhost" || host === "127.0.0.1" || host === "::1")) return u;

  const blocked = new OutboundBlocked(
    `Flaw Patrol can't connect to ${host}: it's an internal network address. If ${service} really runs inside the company network, ask IT to add ${host} to OUTBOUND_ALLOW_HOSTS.`,
  );
  if (u.protocol !== "https:") throw new OutboundBlocked(`The ${service} address must start with https://.`);
  if (INTERNAL_NAME.test(host)) throw blocked;
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw blocked;
    return u;
  }
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS && !opts.resolve) {
    if (!hit.ok) throw blocked;
    return u;
  }
  let addresses: string[];
  try {
    addresses = opts.resolve ? await opts.resolve(host) : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw new OutboundBlocked(`Couldn't find ${host}. Check the ${service} address.`);
  }
  const ok = addresses.length > 0 && !addresses.some(isBlockedAddress);
  if (!opts.resolve) cache.set(host, { ok, at: Date.now() });
  if (!ok) throw blocked;
  return u;
}

/** Jira Cloud sites. Other Jira hosts need OUTBOUND_ALLOW_HOSTS (review H2: allowlist *.atlassian.net). */
export function jiraHostProblem(siteUrl: string, allow: Set<string> = allowedHosts(), production = process.env.NODE_ENV === "production"): string | null {
  let u: URL;
  try {
    u = new URL(siteUrl);
  } catch {
    return "Enter the site address, like https://yourcompany.atlassian.net";
  }
  const host = u.hostname.toLowerCase();
  if (allow.has(host) || allow.has(u.host.toLowerCase())) return null;
  if (!production && (host === "localhost" || host === "127.0.0.1")) return null;
  if (u.protocol === "https:" && (host.endsWith(".atlassian.net") || host.endsWith(".jira.com"))) return null;
  return `Use your Jira Cloud address, like https://yourcompany.atlassian.net. For a Jira server inside the company, ask IT to add ${host} to OUTBOUND_ALLOW_HOSTS.`;
}
